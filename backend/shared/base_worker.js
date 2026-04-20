'use strict';

// =====================================================================
// BaseWorker — shared run loop for every ingestion worker.
//
// Subclasses provide (as instance properties or overrides):
//   source_id         string, e.g. 'uspto-patentsview'
//   tier              string, one of A–G
//   authEnvVar        string, e.g. 'GITHUB_TOKEN' (for auth error messages)
//   requestsPerSecond number, used by the self-rate-limiter
//   async *pages({ mode, cursor, signal })
//     yields { docs, nextCursor }       // one batch per page
//   parseDocument(rawDoc) -> {
//       native_id, doc_type, title, abstract?, url?, published_at?,
//       language?, metadata?, embedText  }
//     throw DocumentValidationError to skip a single doc
//
// Base class owns:
//   • HTTP retry + rate-limited fetchPage()
//   • pg_advisory_lock per source_id (via WorkerPersistence)
//   • Cursor resume (opt-in via --resume, staleness-gated by --force)
//   • source_ingestion_log lifecycle (running → success | failed)
//   • Skip-rate guardrail (>= 50 total AND skip/total > 25%)
//   • Batch embedding via the Embeddings adapter
//   • Batch upsert on (source_id, native_id)
//   • --dry-run: fetch + parse + validate only; no embed/upsert/log-write
//
// Parallelism note:
//   v1 assumes the orchestrator runs workers serially. Each worker
//   self-rate-limits; the pg advisory lock is the secondary safeguard
//   against accidental concurrent invocations of the same source. If
//   we later want cross-worker parallelism, the extension point is an
//   orchestrator-level shared token bucket keyed by API credential
//   (e.g. GITHUB_TOKEN). Workers are independent; do not add shared
//   state inside the worker class itself.
// =====================================================================

const {
  SourceApiAuthError,
  SourceApiTransientError,
  SourceApiPermanentError,
  SourceSchemaError,
  DocumentValidationError,
  EmbeddingError,
  WorkerLockError,
  CursorStaleError,
  classifyHttpError,
} = require('./worker_errors.js');

const DEFAULT_MAX_HTTP_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;
const CURSOR_STALENESS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const SKIP_RATE_MIN_BATCH = 50;
const SKIP_RATE_THRESHOLD = 0.25;

class BaseWorker {
  constructor(opts = {}) {
    const {
      persistence,
      embeddings,
      fetchImpl = globalThis.fetch.bind(globalThis),
      logger = defaultLogger,
      requestsPerSecond,
      maxHttpAttempts = DEFAULT_MAX_HTTP_ATTEMPTS,
      baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
      now = () => new Date(),
      sleep: sleepImpl = defaultSleep,
      randomJitter = Math.random,
    } = opts;

    if (!persistence) throw new TypeError('BaseWorker requires { persistence }');
    if (!embeddings) throw new TypeError('BaseWorker requires { embeddings }');

    this.persistence = persistence;
    this.embeddings = embeddings;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.maxHttpAttempts = maxHttpAttempts;
    this.baseBackoffMs = baseBackoffMs;
    this.now = now;
    this._sleep = sleepImpl;
    this.randomJitter = randomJitter;

    const rps = requestsPerSecond ?? this.requestsPerSecond ?? 2;
    this.limiter = new RateLimiter({
      requestsPerSecond: rps,
      now: () => Date.now(),
      sleep: sleepImpl,
    });
  }

  // ---------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------

  async run({ mode = 'delta', limit = null, dryRun = false, resume = false, force = false } = {}) {
    if (mode !== 'backfill' && mode !== 'delta') {
      throw new TypeError(`unknown mode: ${mode}`);
    }

    const source = this.source_id;
    const { acquired } = await this.persistence.tryAdvisoryLock(source);
    if (!acquired) {
      throw new WorkerLockError(
        `another process is already running source '${source}' (pg advisory lock held)`,
      );
    }

    let cursor = null;
    if (resume) {
      cursor = await this._resolveResumeCursor(force);
    }

    const runId = dryRun ? null : await this.persistence.startRun(source, mode, cursor);
    let ingested = 0;
    let skipped = 0;

    try {
      this.logger('info', {
        event: 'worker_run_started',
        source,
        mode,
        resume,
        dry_run: dryRun,
        cursor,
        limit,
      });

      for await (const page of this.pages({ mode, cursor })) {
        if (limit != null && ingested >= limit) break;

        const { parsedDocs, batchSkipped } = this._parsePage(page.docs);
        skipped += batchSkipped;

        this._enforceSkipRateGuardrail(page.docs.length, batchSkipped);

        let docsToAct = parsedDocs;
        if (limit != null) {
          const remaining = limit - ingested;
          if (remaining <= 0) break;
          docsToAct = parsedDocs.slice(0, remaining);
        }

        if (docsToAct.length > 0) {
          if (dryRun) {
            this.logger('info', {
              event: 'dry_run_batch',
              source,
              would_ingest: docsToAct.length,
              batch_skipped: batchSkipped,
            });
            ingested += docsToAct.length;
          } else {
            const added = await this._embedAndUpsert(docsToAct);
            ingested += added;
          }
        }

        cursor = page.nextCursor ?? cursor;
        if (!dryRun) {
          await this.persistence.updateRun(runId, {
            docs_ingested: ingested,
            docs_skipped: skipped,
            cursor,
          });
        }
      }

      if (!dryRun) {
        await this.persistence.finishRun(runId, {
          status: 'success',
          error: null,
          docs_ingested: ingested,
          docs_skipped: skipped,
        });
      }
      this.logger('info', {
        event: 'worker_run_finished',
        source,
        status: 'success',
        docs_ingested: ingested,
        docs_skipped: skipped,
      });
      return { status: 'success', ingested, skipped, cursor };
    } catch (err) {
      if (err instanceof SourceApiAuthError) {
        this.logger('error', { event: 'auth_failure', source });
      }
      this.logger('error', {
        event: 'worker_run_failed',
        source,
        error: err.message,
        error_type: err.name,
      });
      if (!dryRun && runId != null) {
        await this.persistence.finishRun(runId, {
          status: 'failed',
          error: err.message,
          docs_ingested: ingested,
          docs_skipped: skipped,
        });
      }
      throw err;
    } finally {
      await this.persistence.releaseLock(source);
    }
  }

  // ---------------------------------------------------------------------
  // Helpers available to subclasses
  // ---------------------------------------------------------------------

  async fetchPage(url, opts = {}) {
    await this.limiter.acquire();
    return this._retryingFetch(url, opts);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  async _resolveResumeCursor(force) {
    const last = await this.persistence.lastCompletedRun(this.source_id);
    if (!last) {
      this.logger('warn', { event: 'resume_no_prior_run', source: this.source_id });
      return null;
    }
    const finishedAt =
      last.finished_at instanceof Date ? last.finished_at : new Date(last.finished_at);
    const ageMs = this.now().getTime() - finishedAt.getTime();
    if (ageMs > CURSOR_STALENESS_WINDOW_MS) {
      if (!force) {
        throw new CursorStaleError(
          `cursor for '${this.source_id}' is stale (last finish: ${finishedAt.toISOString()}, ` +
            `age: ${Math.round(ageMs / 3_600_000)}h). Re-run with --resume --force to accept the gap.`,
        );
      }
      this.logger('warn', {
        event: 'resume_cursor_stale_accepted',
        source: this.source_id,
        last_finished_at: finishedAt.toISOString(),
        age_hours: Math.round(ageMs / 3_600_000),
      });
    }
    const cursor = (last.metadata && last.metadata.cursor) ?? null;
    this.logger('info', { event: 'resume_cursor_loaded', source: this.source_id, cursor });
    return cursor;
  }

  _parsePage(rawDocs) {
    const parsedDocs = [];
    let batchSkipped = 0;
    for (const raw of rawDocs) {
      try {
        const doc = this.parseDocument(raw);
        doc.source_id = this.source_id; // enforced by base class
        parsedDocs.push(doc);
      } catch (err) {
        if (err instanceof DocumentValidationError) {
          batchSkipped += 1;
          this.logger('warn', {
            event: 'doc_skipped',
            source: this.source_id,
            native_id: err.nativeId,
            field: err.field,
            reason: err.message,
          });
        } else {
          throw err;
        }
      }
    }
    return { parsedDocs, batchSkipped };
  }

  _enforceSkipRateGuardrail(batchTotal, batchSkipped) {
    if (batchTotal < SKIP_RATE_MIN_BATCH) return;
    if (batchSkipped / batchTotal > SKIP_RATE_THRESHOLD) {
      throw new SourceSchemaError(
        `skip rate ${batchSkipped}/${batchTotal} exceeds ${SKIP_RATE_THRESHOLD * 100}% for source ` +
          `'${this.source_id}' — source schema drift suspected`,
      );
    }
  }

  async _embedAndUpsert(docs) {
    let embeddings;
    try {
      const texts = docs.map((d) => d.embedText);
      embeddings = await this.embeddings.embedBatch(texts);
    } catch (err) {
      throw new EmbeddingError(`embedding failed: ${err.message}`);
    }
    const withEmbeddings = docs.map((d, i) => ({
      source_id: d.source_id,
      native_id: d.native_id,
      doc_type: d.doc_type,
      title: d.title,
      abstract: d.abstract ?? null,
      url: d.url ?? null,
      published_at: d.published_at ?? null,
      language: d.language ?? 'en',
      metadata: d.metadata ?? {},
      embedding: embeddings[i],
    }));
    const { inserted, updated } = await this.persistence.upsertDocuments(withEmbeddings);
    return inserted + updated;
  }

  async _retryingFetch(url, opts) {
    let lastErr;
    for (let attempt = 1; attempt <= this.maxHttpAttempts; attempt += 1) {
      try {
        const res = await this.fetchImpl(url, opts);
        if (!res.ok) {
          let body;
          try {
            body = await res.text();
          } catch {
            body = undefined;
          }
          throw classifyHttpError(res.status, body, this.source_id, {
            authEnvVar: this.authEnvVar,
            headers: res.headers,
          });
        }
        return res;
      } catch (err) {
        lastErr = err;
        const retryable = this._isHttpRetryable(err);
        if (!retryable || attempt === this.maxHttpAttempts) {
          throw err;
        }
        const delay = this._backoffMs(attempt, err);
        this.logger('warn', {
          event: 'http_retry',
          source: this.source_id,
          attempt,
          next_delay_ms: delay,
          status: err && err.status,
          retry_after_ms: err && err.retryAfterMs,
          error: err.message,
        });
        await this._sleep(delay);
      }
    }
    throw lastErr;
  }

  _isHttpRetryable(err) {
    if (err instanceof SourceApiTransientError) return true;
    if (err instanceof SourceApiAuthError || err instanceof SourceApiPermanentError) return false;
    // Native fetch network errors surface as TypeError.
    if (err && err.name === 'TypeError') return true;
    if (
      err &&
      (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND')
    ) {
      return true;
    }
    return false;
  }

  _backoffMs(attempt, err) {
    // Explicit Retry-After from the server always wins.
    if (err && Number.isFinite(err.retryAfterMs) && err.retryAfterMs >= 0) {
      return Math.round(err.retryAfterMs);
    }
    // 429 without Retry-After: back off much more than for generic 5xx.
    // Sources that throttle us deserve patience, and our earlier
    // restart-loop may have poisoned our IP reputation — starting at
    // 30s and doubling gives the server meaningful recovery time.
    const is429 = err && err.status === 429;
    const baseMs = is429 ? TOO_MANY_REQUESTS_BACKOFF_MS : this.baseBackoffMs;
    const base = baseMs * 2 ** (attempt - 1);
    const jitter = 1 + (this.randomJitter() - 0.5) * 0.5; // ±25%
    return Math.round(base * jitter);
  }
}

const TOO_MANY_REQUESTS_BACKOFF_MS = 30_000;

// ---------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------

class RateLimiter {
  constructor({ requestsPerSecond, now = () => Date.now(), sleep = defaultSleep }) {
    if (requestsPerSecond <= 0) {
      throw new TypeError('requestsPerSecond must be > 0');
    }
    this.intervalMs = 1000 / requestsPerSecond;
    this.nextAvailableAt = 0;
    this.now = now;
    this.sleep = sleep;
  }

  async acquire() {
    const nowMs = this.now();
    const wait = Math.max(0, this.nextAvailableAt - nowMs);
    this.nextAvailableAt = Math.max(nowMs, this.nextAvailableAt) + this.intervalMs;
    if (wait > 0) await this.sleep(wait);
  }
}

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLogger(level, event) {
  const want = process.env.LOG_LEVEL || 'info';
  if (level === 'debug' && want !== 'debug') return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify({ level, ts: new Date().toISOString(), ...event }));
}

module.exports = {
  BaseWorker,
  RateLimiter,
  CURSOR_STALENESS_WINDOW_MS,
  SKIP_RATE_MIN_BATCH,
  SKIP_RATE_THRESHOLD,
};
