'use strict';

// =====================================================================
// Embedding caches — interchangeable implementations of:
//
//   async get(key)                  -> number[] | null
//   async getBatch(keys)            -> Map<key, number[]>
//   async set(key, model, vector)   -> void
//   async setBatch(entries)         -> void
//     entries: Array<{ key, model, embedding }>
//   async touch(keys)               -> void  (update last_used_at; best-effort)
//
// Three impls:
//   NullCache           — no-op; use when caching is undesirable
//   MemoryCache         — process-local Map; primarily for tests
//   PostgresEmbeddingCache — durable store backed by the embedding_cache
//                           table from migration 002
//
// Adapter wires one of these in. Embeddings.embed*() never sees pgvector
// type details — vectors are passed in/out as plain number[].
// =====================================================================

class NullCache {
  // eslint-disable-next-line no-unused-vars
  async get(_key) {
    return null;
  }

  async getBatch(keys) {
    return new Map(keys.map((k) => [k, null]));
  }

  // eslint-disable-next-line no-unused-vars
  async set(_key, _model, _vector) {}

  // eslint-disable-next-line no-unused-vars
  async setBatch(_entries) {}

  // eslint-disable-next-line no-unused-vars
  async touch(_keys) {}
}

class MemoryCache {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    const entry = this.store.get(key);
    return entry ? entry.embedding.slice() : null;
  }

  async getBatch(keys) {
    const out = new Map();
    for (const key of keys) {
      const entry = this.store.get(key);
      out.set(key, entry ? entry.embedding.slice() : null);
    }
    return out;
  }

  async set(key, model, vector) {
    this.store.set(key, { model, embedding: vector.slice(), lastUsed: Date.now() });
  }

  async setBatch(entries) {
    for (const { key, model, embedding } of entries) {
      this.store.set(key, { model, embedding: embedding.slice(), lastUsed: Date.now() });
    }
  }

  async touch(keys) {
    const now = Date.now();
    for (const key of keys) {
      const entry = this.store.get(key);
      if (entry) entry.lastUsed = now;
    }
  }

  size() {
    return this.store.size;
  }
}

// PostgresEmbeddingCache uses pgvector text serialization '[v1,v2,...]' for
// inserts (which the vector type accepts) and parses the same form on read.
// Avoids a dependency on a vector-specific pg type parser.
class PostgresEmbeddingCache {
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') {
      throw new TypeError('PostgresEmbeddingCache requires a pg Pool/Client with .query()');
    }
    this.pool = pool;
  }

  async get(key) {
    const { rows } = await this.pool.query(
      'SELECT embedding FROM embedding_cache WHERE cache_key = $1 LIMIT 1',
      [key],
    );
    if (rows.length === 0) return null;
    return parseVector(rows[0].embedding);
  }

  async getBatch(keys) {
    const out = new Map(keys.map((k) => [k, null]));
    if (keys.length === 0) return out;
    const { rows } = await this.pool.query(
      'SELECT cache_key, embedding FROM embedding_cache WHERE cache_key = ANY($1::text[])',
      [keys],
    );
    for (const row of rows) {
      out.set(row.cache_key, parseVector(row.embedding));
    }
    return out;
  }

  async set(key, model, vector) {
    await this.pool.query(
      `INSERT INTO embedding_cache (cache_key, model, embedding)
       VALUES ($1, $2, $3::vector)
       ON CONFLICT (cache_key) DO NOTHING`,
      [key, model, formatVector(vector)],
    );
  }

  async setBatch(entries) {
    if (entries.length === 0) return;
    // Multi-row INSERT with explicit casts; ON CONFLICT keeps it idempotent.
    const placeholders = [];
    const values = [];
    let p = 1;
    for (const { key, model, embedding } of entries) {
      placeholders.push(`($${p}, $${p + 1}, $${p + 2}::vector)`);
      values.push(key, model, formatVector(embedding));
      p += 3;
    }
    await this.pool.query(
      `INSERT INTO embedding_cache (cache_key, model, embedding)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (cache_key) DO NOTHING`,
      values,
    );
  }

  async touch(keys) {
    if (keys.length === 0) return;
    await this.pool.query(
      'UPDATE embedding_cache SET last_used_at = NOW() WHERE cache_key = ANY($1::text[])',
      [keys],
    );
  }
}

function formatVector(vec) {
  // pgvector accepts '[1,2,3]'-style text; avoid scientific notation and trim.
  return `[${vec.join(',')}]`;
}

function parseVector(serialized) {
  if (Array.isArray(serialized)) return serialized;
  if (typeof serialized !== 'string') {
    throw new TypeError(`unexpected vector serialization: ${typeof serialized}`);
  }
  // pgvector returns '[v1,v2,...]'. Strip brackets, split, parseFloat.
  const inner = serialized.replace(/^\[|\]$/g, '');
  if (inner.length === 0) return [];
  return inner.split(',').map(Number);
}

module.exports = {
  NullCache,
  MemoryCache,
  PostgresEmbeddingCache,
  formatVector,
  parseVector,
};
