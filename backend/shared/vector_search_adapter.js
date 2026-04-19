'use strict';

// =====================================================================
// Vector search adapter — runs cosine-similarity nearest-neighbor
// queries against prior_art_documents, reweighs by source tier, and
// returns the shape prior_art_search.js expects.
//
// Runtime-agnostic: the adapter takes an async `runQuery(sql, params)`
// function. The Netlify function wraps @neondatabase/serverless around
// this contract; ingestion workers (if they ever need to search) wrap
// pg.Pool around it. Tests wrap an in-process query simulator.
//
// Contract — the shape prior_art_search.js' searchPriorArt() hands to
// this adapter's .search() and expects back:
//
//   search({ query, limit, source_tiers, source_weights })
//     returns Array<{
//       title, source_id, source_name, doc_type,
//       url, date, abstract, snippet,
//       similarity_score, source_tier
//     }>
// =====================================================================

const { formatVector } = require('./embedding_cache.js');

const DEFAULT_LIMIT = 10;
const FETCH_MULTIPLIER = 2; // over-fetch so reweighting can actually reorder

class VectorSearchAdapter {
  constructor({ embeddings, runQuery, registry, logger = defaultLogger } = {}) {
    if (!embeddings) throw new TypeError('VectorSearchAdapter requires { embeddings }');
    if (typeof runQuery !== 'function') {
      throw new TypeError('VectorSearchAdapter requires { runQuery } as an async fn');
    }
    if (!registry || typeof registry.listAll !== 'function') {
      throw new TypeError('VectorSearchAdapter requires { registry } with listAll()/getEntry()');
    }
    this.embeddings = embeddings;
    this.runQuery = runQuery;
    this.registry = registry;
    this.logger = logger;
  }

  async search({
    query,
    limit = DEFAULT_LIMIT,
    source_tiers = null,
    source_weights = {},
    inputType = 'query',
  } = {}) {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new TypeError('search() requires a non-empty query string');
    }

    const [queryVector] = await this.embeddings.embedBatch([query], { inputType });

    const sourceIds = this._resolveSourceIds(source_tiers);
    if (sourceIds.length === 0) {
      this.logger('warn', { event: 'vector_search_no_sources', source_tiers });
      return [];
    }

    const fetchLimit = Math.max(limit * FETCH_MULTIPLIER, 20);
    const rows = await this.runQuery(
      `SELECT source_id, native_id, doc_type, title, abstract, url,
              published_at, metadata,
              1 - (embedding <=> $1::vector) AS similarity
         FROM prior_art_documents
        WHERE embedding IS NOT NULL
          AND source_id = ANY($2::text[])
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [formatVector(queryVector), sourceIds, fetchLimit],
    );

    const weighted = this._weightAndNormalize(rows, source_weights);
    return weighted.slice(0, limit);
  }

  _resolveSourceIds(tiers) {
    const implemented = this.registry.listImplemented().map((e) => e.id);
    if (!tiers || tiers.length === 0) return implemented;

    const tierSet = new Set(tiers);
    const implementedSet = new Set(implemented);
    return this.registry
      .listAll()
      .filter((e) => tierSet.has(e.tier))
      .filter((e) => implementedSet.has(e.id))
      .map((e) => e.id);
  }

  _weightAndNormalize(rows, source_weights) {
    const mapped = rows.map((r) => {
      const tier = this._tierFor(r.source_id);
      const baseSimilarity = Number(r.similarity);
      const weight = (source_weights && source_weights[tier]) ?? 1.0;
      const weighted = Number.isFinite(baseSimilarity) ? baseSimilarity * weight : 0;
      const abstract = r.abstract || '';
      return {
        title: r.title || '(untitled)',
        source_id: r.source_id,
        source_name: r.source_id,
        native_id: r.native_id,
        doc_type: r.doc_type,
        url: r.url || null,
        date: r.published_at || null,
        abstract,
        snippet: abstract.slice(0, 400),
        similarity_score: weighted,
        raw_similarity: baseSimilarity,
        source_tier: tier,
      };
    });
    mapped.sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0));
    return mapped;
  }

  _tierFor(source_id) {
    const entry = this.registry.getEntry(source_id);
    return entry ? entry.tier : null;
  }
}

// ---------------------------------------------------------------------
// Neon adapter: wraps @neondatabase/serverless into the runQuery contract.
// The neon() client returned from `neon(url)` supports two call forms:
//   • Template-literal: await sql`SELECT ...`
//   • Function: await sql(text, params)
// We use the function form.
// ---------------------------------------------------------------------

function neonRunQuery(neonSql) {
  return async (text, params) => {
    const result = await neonSql(text, params);
    return Array.isArray(result) ? result : result.rows || [];
  };
}

// ---------------------------------------------------------------------
// pg.Pool adapter: wraps a pg Pool/Client's .query() into the contract.
// ---------------------------------------------------------------------

function poolRunQuery(pool) {
  return async (text, params) => {
    const { rows } = await pool.query(text, params);
    return rows;
  };
}

function defaultLogger(level, event) {
  const want = process.env.LOG_LEVEL || 'info';
  if (level === 'debug' && want !== 'debug') return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify({ level, ts: new Date().toISOString(), ...event }));
}

module.exports = {
  VectorSearchAdapter,
  neonRunQuery,
  poolRunQuery,
};
