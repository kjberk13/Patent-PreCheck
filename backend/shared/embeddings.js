'use strict';

// =====================================================================
// Embeddings adapter — Voyage primary, OpenAI fallback, 1024-dim output.
//
// Behaviour:
//   • embed(text)        -> number[]    (1024 floats)
//   • embedBatch(texts)  -> number[][]  (in input order)
//
// • Voyage voyage-3-large uses Matryoshka Representation Learning and
//   only accepts output_dimension ∈ {256, 512, 1024, 2048}. We
//   standardise on 1024 — within ~0.3% of 2048 in Voyage's published
//   retrieval benchmarks at 33% smaller vectors than 1536.
// • OpenAI text-embedding-3-small supports dimensions=1024 natively
//   via its Matryoshka-compatible API, so the fallback still returns
//   same-shape vectors for cache compatibility.
// • Truncates inputs estimated to exceed MAX_INPUT_TOKENS (8000 token cap,
//   shared between Voyage and OpenAI). Uses a 3-chars-per-token heuristic
//   with a small safety margin; logs {event: 'embedding_truncated'} on
//   each fire.
// • Retries transient errors (HTTP 429/5xx, network) up to 3 attempts
//   total per provider with exponential backoff + jitter.
// • On exhausted retries against the primary provider, logs a fallback
//   event and tries the secondary provider once with the same retry
//   budget. If both fail, throws the secondary error to the caller.
// • Caches by sha256(model_id || '|' || normalized_text). Default cache
//   is PostgresEmbeddingCache against DATABASE_URL when set, NullCache
//   otherwise. Pass cache: null or any object implementing the cache
//   interface to override.
// =====================================================================

require('dotenv').config();

const crypto = require('node:crypto');

const { NullCache, PostgresEmbeddingCache } = require('./embedding_cache.js');

const MAX_INPUT_TOKENS = 8000;
// 3.0 chars/token is conservative for English BPE tokenizers (cl100k ~3.5–4,
// voyage tokenizer roughly comparable). Keeps us well clear of provider caps.
const CHARS_PER_TOKEN = 3.0;
const MAX_INPUT_CHARS = MAX_INPUT_TOKENS * CHARS_PER_TOKEN;
const EMBEDDING_DIMENSIONS = 1024;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;

const VOYAGE_MAX_BATCH = 128;
const OPENAI_MAX_BATCH = 2048;
const DEFAULT_BATCH_SIZE = 64;

const PROVIDER_VOYAGE = 'voyage';
const PROVIDER_OPENAI = 'openai';

const DEFAULT_VOYAGE_MODEL = 'voyage-3-large';
const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';

class Embeddings {
  constructor(opts = {}) {
    const {
      provider = process.env.EMBEDDING_PROVIDER || PROVIDER_VOYAGE,
      voyageModel = process.env.EMBEDDING_MODEL || DEFAULT_VOYAGE_MODEL,
      openaiModel = DEFAULT_OPENAI_MODEL,
      voyageApiKey = process.env.VOYAGE_API_KEY,
      openaiApiKey = process.env.OPENAI_API_KEY,
      voyageEndpoint = 'https://api.voyageai.com/v1/embeddings',
      openaiEndpoint = 'https://api.openai.com/v1/embeddings',
      inputType = 'document', // 'document' or 'query' (voyage)
      cache, // undefined = build default; null = NullCache; else use as-is
      pgPool, // optional pg Pool for the default PostgresEmbeddingCache
      fetchImpl = globalThis.fetch.bind(globalThis),
      logger = defaultLogger,
      maxAttempts = DEFAULT_MAX_ATTEMPTS,
      baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
      now = () => Date.now(),
      randomJitter = Math.random,
    } = opts;

    if (provider !== PROVIDER_VOYAGE && provider !== PROVIDER_OPENAI) {
      throw new Error(
        `Unknown EMBEDDING_PROVIDER: ${provider}. Expected '${PROVIDER_VOYAGE}' or '${PROVIDER_OPENAI}'.`,
      );
    }

    this.primary = provider;
    this.secondary = provider === PROVIDER_VOYAGE ? PROVIDER_OPENAI : PROVIDER_VOYAGE;
    this.voyageModel = voyageModel;
    this.openaiModel = openaiModel;
    this.voyageApiKey = voyageApiKey;
    this.openaiApiKey = openaiApiKey;
    this.voyageEndpoint = voyageEndpoint;
    this.openaiEndpoint = openaiEndpoint;
    this.inputType = inputType;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.maxAttempts = maxAttempts;
    this.baseBackoffMs = baseBackoffMs;
    this.now = now;
    this.randomJitter = randomJitter;

    this.cache = resolveCache(cache, pgPool);
  }

  modelIdFor(provider) {
    const base = provider === PROVIDER_VOYAGE ? this.voyageModel : this.openaiModel;
    return `${base}@${EMBEDDING_DIMENSIONS}`;
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  async embed(text, opts = {}) {
    const [vec] = await this.embedBatch([text], opts);
    return vec;
  }

  async embedBatch(texts, opts = {}) {
    if (!Array.isArray(texts)) {
      throw new TypeError('embedBatch expects an array of strings');
    }
    if (texts.length === 0) return [];
    for (const t of texts) {
      if (typeof t !== 'string') {
        throw new TypeError('embedBatch inputs must all be strings');
      }
    }

    const { batchSize = DEFAULT_BATCH_SIZE, updateLastUsedOnHit = true } = opts;
    const cache = opts.cache !== undefined ? resolveCache(opts.cache) : this.cache;

    const prepared = texts.map((t) => this._prepareInput(t));

    // Cache lookup on the *primary* model id. If we fall back to the secondary
    // for some inputs, those write to a different model_id key (no collision).
    const primaryModelId = this.modelIdFor(this.primary);
    const keys = prepared.map((p) => cacheKeyFor(primaryModelId, p.text));
    const hits = await cache.getBatch(keys);

    const out = new Array(texts.length);
    const missIndices = [];
    let hitCount = 0;
    for (let i = 0; i < texts.length; i += 1) {
      const cached = hits.get(keys[i]);
      if (cached && cached.length === EMBEDDING_DIMENSIONS) {
        out[i] = cached;
        hitCount += 1;
      } else {
        missIndices.push(i);
      }
    }

    this.logger('debug', { event: 'embedding_cache_hit', count: hitCount, total: texts.length });
    this.logger('debug', {
      event: 'embedding_cache_miss',
      count: missIndices.length,
      total: texts.length,
    });

    if (updateLastUsedOnHit && hitCount > 0) {
      const hitKeys = [];
      for (let i = 0; i < texts.length; i += 1) {
        if (out[i] !== undefined) hitKeys.push(keys[i]);
      }
      cache.touch(hitKeys).catch((err) => {
        this.logger('warn', { event: 'embedding_cache_touch_failed', error: errorToString(err) });
      });
    }

    if (missIndices.length === 0) return out;

    const missTexts = missIndices.map((i) => prepared[i].text);
    const { embeddings, providerUsed } = await this._embedWithFallback(missTexts, batchSize);

    const writeEntries = [];
    const usedModelId = this.modelIdFor(providerUsed);
    for (let j = 0; j < missIndices.length; j += 1) {
      const idx = missIndices[j];
      const vec = embeddings[j];
      assertDimensions(vec);
      out[idx] = vec;
      // Cache against whichever provider actually produced the vector. If
      // primary recovers later, future calls will see misses and re-embed
      // (acceptable price for not poisoning the primary's cache namespace).
      writeEntries.push({
        key: cacheKeyFor(usedModelId, missTexts[j]),
        model: usedModelId,
        embedding: vec,
      });
    }

    if (writeEntries.length > 0) {
      try {
        await cache.setBatch(writeEntries);
      } catch (err) {
        this.logger('warn', { event: 'embedding_cache_write_failed', error: errorToString(err) });
      }
    }

    return out;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  _prepareInput(text) {
    if (text.length <= MAX_INPUT_CHARS) {
      return { text };
    }
    const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
    this.logger('warn', {
      event: 'embedding_truncated',
      token_count: estimatedTokens,
      max_tokens: MAX_INPUT_TOKENS,
    });
    return { text: text.slice(0, MAX_INPUT_CHARS) };
  }

  async _embedWithFallback(texts, batchSize) {
    try {
      const embeddings = await this._embedWithProvider(this.primary, texts, batchSize);
      return { embeddings, providerUsed: this.primary };
    } catch (primaryErr) {
      const canFallback =
        this.secondary === PROVIDER_OPENAI
          ? Boolean(this.openaiApiKey)
          : Boolean(this.voyageApiKey);
      if (!canFallback) {
        throw primaryErr;
      }
      this.logger('warn', {
        event: 'embedding_provider_fallback',
        from: this.primary,
        to: this.secondary,
        reason: errorToString(primaryErr),
      });
      const embeddings = await this._embedWithProvider(this.secondary, texts, batchSize);
      return { embeddings, providerUsed: this.secondary };
    }
  }

  async _embedWithProvider(provider, texts, batchSize) {
    const providerMax = provider === PROVIDER_VOYAGE ? VOYAGE_MAX_BATCH : OPENAI_MAX_BATCH;
    const effectiveBatch = Math.max(1, Math.min(batchSize, providerMax));

    const all = new Array(texts.length);
    for (let offset = 0; offset < texts.length; offset += effectiveBatch) {
      const slice = texts.slice(offset, offset + effectiveBatch);
      const vectors = await this._withRetry(provider, () =>
        provider === PROVIDER_VOYAGE ? this._callVoyage(slice) : this._callOpenai(slice),
      );
      for (let j = 0; j < vectors.length; j += 1) {
        all[offset + j] = vectors[j];
      }
    }
    return all;
  }

  async _withRetry(provider, fn) {
    let lastErr;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt === this.maxAttempts) {
          throw err;
        }
        const delay = this._backoffMs(attempt);
        this.logger('warn', {
          event: 'embedding_retry',
          provider,
          attempt,
          next_delay_ms: delay,
          error: errorToString(err),
        });
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  _backoffMs(attempt) {
    const base = this.baseBackoffMs * 2 ** (attempt - 1);
    const jitter = 1 + (this.randomJitter() - 0.5) * 0.5; // ±25%
    return Math.round(base * jitter);
  }

  async _callVoyage(texts) {
    if (!this.voyageApiKey) {
      throw new EmbeddingsError('VOYAGE_API_KEY is not set', { retryable: false });
    }
    const res = await this.fetchImpl(this.voyageEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.voyageApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texts,
        model: this.voyageModel,
        input_type: this.inputType,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) {
      throw await EmbeddingsError.fromResponse('voyage', res);
    }
    const data = await res.json();
    return data.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((row) => row.embedding);
  }

  async _callOpenai(texts) {
    if (!this.openaiApiKey) {
      throw new EmbeddingsError('OPENAI_API_KEY is not set', { retryable: false });
    }
    const res = await this.fetchImpl(this.openaiEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texts,
        model: this.openaiModel,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) {
      throw await EmbeddingsError.fromResponse('openai', res);
    }
    const data = await res.json();
    return data.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((row) => row.embedding);
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function resolveCache(cache, pgPool) {
  if (cache === null) return new NullCache();
  if (cache !== undefined) return cache;
  if (pgPool) return new PostgresEmbeddingCache(pgPool);
  // Default cache wiring: only build a Postgres cache if DATABASE_URL is
  // present (workers in production), else NullCache (tests, local CLI use).
  if (process.env.DATABASE_URL) {
    // Lazy-require so tests/CLI tools without pg installed don't pay for it.
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return new PostgresEmbeddingCache(pool);
  }
  return new NullCache();
}

function cacheKeyFor(modelId, text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(`${modelId}|${normalized}`).digest('hex');
}

function assertDimensions(vec) {
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingsError(
      `embedding has wrong dimension: expected ${EMBEDDING_DIMENSIONS}, got ${
        Array.isArray(vec) ? vec.length : typeof vec
      }`,
      { retryable: false },
    );
  }
}

function isRetryable(err) {
  if (err && err.retryable === true) return true;
  if (err && err.status && RETRYABLE_STATUS.has(err.status)) return true;
  if (err && err.name === 'TypeError') return true; // fetch network error
  if (err && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND')) {
    return true;
  }
  return false;
}

function errorToString(err) {
  if (!err) return String(err);
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return String(err);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLogger(level, event) {
  const want = process.env.LOG_LEVEL || 'info';
  if (level === 'debug' && want !== 'debug') return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify({ level, ...event }));
}

class EmbeddingsError extends Error {
  constructor(message, { status, retryable, body } = {}) {
    super(message);
    this.name = 'EmbeddingsError';
    this.status = status;
    this.retryable = retryable === true || (status !== undefined && RETRYABLE_STATUS.has(status));
    // Full body preserved for programmatic inspection; message carries a
    // truncated copy for log readability (see fromResponse below).
    this.body = body;
  }

  static async fromResponse(provider, res) {
    let body;
    try {
      body = await res.text();
    } catch {
      body = undefined;
    }
    const trimmed = typeof body === 'string' && body.length > 0 ? truncateBody(body, 400) : null;
    const bodyTail = trimmed ? ` — body: ${trimmed}` : '';
    return new EmbeddingsError(`${provider} embeddings request failed (${res.status})${bodyTail}`, {
      status: res.status,
      body,
    });
  }
}

function truncateBody(str, max) {
  if (typeof str !== 'string') return str;
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

module.exports = {
  Embeddings,
  EmbeddingsError,
  cacheKeyFor,
  MAX_INPUT_TOKENS,
  MAX_INPUT_CHARS,
  EMBEDDING_DIMENSIONS,
};
