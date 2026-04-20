'use strict';

// =====================================================================
// WorkerPersistence — abstraction over the storage layer used by every
// ingestion worker. Two implementations are shipped:
//
//   PostgresWorkerPersistence   — production, backed by pg.Pool
//   MemoryWorkerPersistence     — tests, backed by in-process Maps
//
// Swapping implementations lets base_worker unit tests run without a
// live Postgres instance; the Postgres impl is exercised end-to-end by
// the per-worker pipeline tests.
//
// Contract (all methods async):
//
//   tryAdvisoryLock(sourceId)
//     -> { acquired: boolean }
//        Best-effort per-source mutex. Must be released in a finally
//        block. Scoped to the connection that acquired it; in the pg
//        impl we pin to a single client.
//
//   releaseLock(sourceId)
//
//   lastCompletedRun(sourceId)
//     -> { id, status, started_at, finished_at, metadata } | null
//        Most recent *finished* run for this source (any status).
//        Used by --resume to recover the cursor.
//
//   startRun(sourceId, mode, cursor)
//     -> runId
//        Inserts a row with status='running', started_at=NOW(), and
//        metadata: { cursor } if provided.
//
//   updateRun(runId, { docs_ingested, docs_skipped, cursor })
//
//   finishRun(runId, { status, error, docs_ingested, docs_skipped })
//     Sets finished_at=NOW() and the final counts.
//
//   upsertDocuments(docs) -> { inserted, updated }
//     Upserts on (source_id, native_id). Each doc carries its own
//     embedding; pass null to leave the embedding column as-is on
//     conflict (rare — workers typically always supply one).
// =====================================================================

const { DatabaseError } = require('./worker_errors.js');
const { formatVector } = require('./embedding_cache.js');

// ---------------------------------------------------------------------
// Postgres implementation
// ---------------------------------------------------------------------

class PostgresWorkerPersistence {
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new TypeError('PostgresWorkerPersistence requires a pg Pool');
    }
    this.pool = pool;
    this._lockClients = new Map(); // sourceId -> pinned pg.Client
  }

  async tryAdvisoryLock(sourceId) {
    let client;
    try {
      client = await this.pool.connect();
    } catch (err) {
      throw wrapDbError(err, 'tryAdvisoryLock (pool.connect)');
    }
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [
        sourceId,
      ]);
      const acquired = rows[0].acquired === true;
      if (acquired) {
        // Pin the client so pg_advisory_unlock runs on the same session.
        this._lockClients.set(sourceId, client);
      } else {
        client.release();
      }
      return { acquired };
    } catch (err) {
      client.release();
      throw wrapDbError(err, 'tryAdvisoryLock');
    }
  }

  async releaseLock(sourceId) {
    const client = this._lockClients.get(sourceId);
    if (!client) return;
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [sourceId]);
    } catch {
      // Best-effort; the lock is released when the session ends anyway.
    } finally {
      this._lockClients.delete(sourceId);
      client.release();
    }
  }

  async lastCompletedRun(sourceId) {
    try {
      const { rows } = await this.pool.query(
        `SELECT id, status, started_at, finished_at, metadata
           FROM source_ingestion_log
          WHERE source_id = $1 AND finished_at IS NOT NULL
          ORDER BY finished_at DESC
          LIMIT 1`,
        [sourceId],
      );
      return rows[0] || null;
    } catch (err) {
      throw wrapDbError(err, 'lastCompletedRun');
    }
  }

  async startRun(sourceId, mode, cursor) {
    const metadata = cursor != null ? { cursor } : {};
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO source_ingestion_log (source_id, mode, status, metadata)
         VALUES ($1, $2, 'running', $3::jsonb)
         RETURNING id`,
        [sourceId, mode, JSON.stringify(metadata)],
      );
      return rows[0].id;
    } catch (err) {
      throw wrapDbError(err, 'startRun');
    }
  }

  async updateRun(runId, { docs_ingested, docs_skipped, cursor }) {
    try {
      // jsonb_set preserves keys callers have set elsewhere in metadata.
      await this.pool.query(
        `UPDATE source_ingestion_log
            SET docs_ingested = $2,
                docs_skipped  = $3,
                metadata      = jsonb_set(metadata, '{cursor}', $4::jsonb, true)
          WHERE id = $1`,
        [runId, docs_ingested, docs_skipped, JSON.stringify(cursor ?? null)],
      );
    } catch (err) {
      throw wrapDbError(err, 'updateRun');
    }
  }

  async finishRun(runId, { status, error, docs_ingested, docs_skipped }) {
    try {
      await this.pool.query(
        `UPDATE source_ingestion_log
            SET status        = $2,
                finished_at   = NOW(),
                docs_ingested = $3,
                docs_skipped  = $4,
                error         = $5
          WHERE id = $1`,
        [runId, status, docs_ingested, docs_skipped, error ?? null],
      );
    } catch (err) {
      throw wrapDbError(err, 'finishRun');
    }
  }

  async upsertDocuments(docs) {
    if (docs.length === 0) return { inserted: 0, updated: 0 };

    const columns = [
      'source_id',
      'native_id',
      'doc_type',
      'title',
      'abstract',
      'url',
      'published_at',
      'language',
      'metadata',
      'embedding',
    ];

    const placeholders = [];
    const values = [];
    let p = 1;

    for (const d of docs) {
      placeholders.push(
        `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}::jsonb, $${p + 9}::vector)`,
      );
      values.push(
        d.source_id,
        d.native_id,
        d.doc_type,
        d.title,
        d.abstract ?? null,
        d.url ?? null,
        d.published_at ?? null,
        d.language ?? 'en',
        JSON.stringify(d.metadata ?? {}),
        d.embedding ? formatVector(d.embedding) : null,
      );
      p += 10;
    }

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO prior_art_documents (${columns.join(', ')})
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (source_id, native_id) DO UPDATE SET
           doc_type     = EXCLUDED.doc_type,
           title        = EXCLUDED.title,
           abstract     = EXCLUDED.abstract,
           url          = EXCLUDED.url,
           published_at = EXCLUDED.published_at,
           language     = EXCLUDED.language,
           metadata     = EXCLUDED.metadata,
           embedding    = COALESCE(EXCLUDED.embedding, prior_art_documents.embedding)
         RETURNING xmax = 0 AS inserted`,
        values,
      );
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        if (row.inserted) inserted += 1;
        else updated += 1;
      }
      return { inserted, updated };
    } catch (err) {
      throw wrapDbError(err, 'upsertDocuments');
    }
  }
}

// ---------------------------------------------------------------------
// In-memory implementation (tests)
// ---------------------------------------------------------------------

class MemoryWorkerPersistence {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.locks = new Set();
    this.runs = new Map(); // id -> row
    this.documents = new Map(); // `${source_id}:${native_id}` -> row
    this.nextRunId = 1;
  }

  async tryAdvisoryLock(sourceId) {
    if (this.locks.has(sourceId)) return { acquired: false };
    this.locks.add(sourceId);
    return { acquired: true };
  }

  async releaseLock(sourceId) {
    this.locks.delete(sourceId);
  }

  async lastCompletedRun(sourceId) {
    const completed = [...this.runs.values()]
      .filter((r) => r.source_id === sourceId && r.finished_at != null)
      .sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1));
    return completed[0] || null;
  }

  async startRun(sourceId, mode, cursor) {
    const id = String(this.nextRunId++);
    const row = {
      id,
      source_id: sourceId,
      mode,
      status: 'running',
      started_at: this.now(),
      finished_at: null,
      docs_ingested: 0,
      docs_skipped: 0,
      error: null,
      metadata: cursor != null ? { cursor } : {},
    };
    this.runs.set(id, row);
    return id;
  }

  async updateRun(runId, { docs_ingested, docs_skipped, cursor }) {
    const row = this.runs.get(runId);
    if (!row) throw new DatabaseError(`run ${runId} not found`);
    row.docs_ingested = docs_ingested;
    row.docs_skipped = docs_skipped;
    if (cursor !== undefined) row.metadata = { ...row.metadata, cursor };
  }

  async finishRun(runId, { status, error, docs_ingested, docs_skipped }) {
    const row = this.runs.get(runId);
    if (!row) throw new DatabaseError(`run ${runId} not found`);
    row.status = status;
    row.finished_at = this.now();
    row.error = error ?? null;
    row.docs_ingested = docs_ingested;
    row.docs_skipped = docs_skipped;
  }

  async upsertDocuments(docs) {
    let inserted = 0;
    let updated = 0;
    for (const d of docs) {
      const key = `${d.source_id}:${d.native_id}`;
      if (this.documents.has(key)) updated += 1;
      else inserted += 1;
      this.documents.set(key, { ...d });
    }
    return { inserted, updated };
  }

  // Helpers for tests
  getRuns() {
    return [...this.runs.values()];
  }
  getDocuments() {
    return [...this.documents.values()];
  }
}

// Errors whose Node code indicates a networking/DNS failure rather than a
// SQL-level problem. When we see these, we append the parsed DATABASE_URL
// hostname to the DatabaseError message so operators can see at a glance
// which hostname pg tried to reach.
const NETWORKING_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function wrapDbError(err, op) {
  const message = err && err.message ? err.message : String(err);
  const code = err && err.code ? err.code : null;
  let hint = '';
  if (code && NETWORKING_ERROR_CODES.has(code)) {
    hint = ` [hint: DATABASE_URL host = "${safeDbHost()}" — check Railway env]`;
  }
  const wrapped = new DatabaseError(`${op} failed: ${message}${hint}`);
  wrapped.cause = err;
  wrapped.code = code;
  return wrapped;
}

function safeDbHost() {
  try {
    return new URL(process.env.DATABASE_URL || '').hostname || '(unset)';
  } catch {
    return '(unparseable)';
  }
}

module.exports = {
  PostgresWorkerPersistence,
  MemoryWorkerPersistence,
};
