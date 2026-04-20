'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');

const {
  Embeddings,
  EmbeddingsError,
  cacheKeyFor,
  MAX_INPUT_TOKENS,
  MAX_INPUT_CHARS,
  EMBEDDING_DIMENSIONS,
} = require('../embeddings.js');
const { MemoryCache, NullCache } = require('../embedding_cache.js');

// ---------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------

const VOYAGE_BASE = 'https://api.voyageai.com';
const VOYAGE_PATH = '/v1/embeddings';
const OPENAI_BASE = 'https://api.openai.com';
const OPENAI_PATH = '/v1/embeddings';

function makeVector(seed) {
  // Deterministic vector sized to EMBEDDING_DIMENSIONS (currently 1024).
  // Different seeds → different vectors.
  const v = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) {
    v[i] = ((i * seed) % 100) / 100;
  }
  return v;
}

function voyageReply(texts) {
  return {
    object: 'list',
    data: texts.map((_, i) => ({ object: 'embedding', index: i, embedding: makeVector(i + 1) })),
    model: 'voyage-3-large',
    usage: { total_tokens: texts.length * 10 },
  };
}

function openaiReply(texts) {
  return {
    object: 'list',
    data: texts.map((_, i) => ({
      object: 'embedding',
      index: i,
      embedding: makeVector((i + 1) * 7),
    })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: 10, total_tokens: 10 },
  };
}

class CapturingLogger {
  constructor() {
    this.events = [];
  }
  fn = (level, event) => {
    this.events.push({ level, ...event });
  };
  byEvent(name) {
    return this.events.filter((e) => e.event === name);
  }
}

function newAdapter(overrides = {}) {
  const logger = new CapturingLogger();
  const adapter = new Embeddings({
    voyageApiKey: 'test-voyage-key',
    openaiApiKey: 'test-openai-key',
    cache: new NullCache(),
    logger: logger.fn,
    baseBackoffMs: 1, // keep retry tests fast
    randomJitter: () => 0.5, // deterministic backoff
    ...overrides,
  });
  return { adapter, logger };
}

test.beforeEach(() => {
  nock.cleanAll();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});

test.afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

// ---------------------------------------------------------------------
// Basic single + batch embedding
// ---------------------------------------------------------------------

test('embed() returns a 1024-dim vector via the primary (voyage)', async () => {
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH)
    .reply(200, voyageReply(['hello']));

  const { adapter } = newAdapter();
  const vec = await adapter.embed('hello');

  assert.equal(vec.length, EMBEDDING_DIMENSIONS);
  assert.equal(typeof vec[0], 'number');
});

test('embedBatch() returns vectors in input order', async () => {
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH, (body) => body.input.length === 3)
    .reply(200, voyageReply(['a', 'b', 'c']));

  const { adapter } = newAdapter();
  const vecs = await adapter.embedBatch(['a', 'b', 'c']);

  assert.equal(vecs.length, 3);
  for (const v of vecs) assert.equal(v.length, EMBEDDING_DIMENSIONS);
  // makeVector is index-sensitive — out-of-order would change the values
  assert.deepEqual(vecs[0].slice(0, 3), makeVector(1).slice(0, 3));
  assert.deepEqual(vecs[2].slice(0, 3), makeVector(3).slice(0, 3));
});

test('dimension assertion throws if provider returns the wrong length', async () => {
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH)
    .reply(200, {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: [1, 2, 3] }],
      model: 'voyage-3-large',
    });

  const { adapter } = newAdapter();
  await assert.rejects(adapter.embed('x'), /wrong dimension/);
});

// ---------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------

test('inputs over MAX_INPUT_CHARS are truncated and a warning is logged', async () => {
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH, (body) => body.input[0].length === MAX_INPUT_CHARS)
    .reply(200, voyageReply(['x']));

  const { adapter, logger } = newAdapter();
  const longText = 'a'.repeat(MAX_INPUT_CHARS + 5000);
  await adapter.embed(longText);

  const trunc = logger.byEvent('embedding_truncated');
  assert.equal(trunc.length, 1);
  assert.equal(trunc[0].max_tokens, MAX_INPUT_TOKENS);
  assert.ok(trunc[0].token_count > MAX_INPUT_TOKENS);
});

test('inputs at or below MAX_INPUT_CHARS are not truncated', async () => {
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH)
    .reply(200, voyageReply(['x']));

  const { adapter, logger } = newAdapter();
  await adapter.embed('a'.repeat(MAX_INPUT_CHARS));

  assert.equal(logger.byEvent('embedding_truncated').length, 0);
});

// ---------------------------------------------------------------------
// Retry + backoff
// ---------------------------------------------------------------------

test('retries on 429 then succeeds', async () => {
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH)
    .reply(429, { error: 'rate limited' })
    .post(VOYAGE_PATH)
    .reply(200, voyageReply(['y']));

  const { adapter, logger } = newAdapter();
  const vec = await adapter.embed('y');

  assert.equal(vec.length, EMBEDDING_DIMENSIONS);
  const retries = logger.byEvent('embedding_retry');
  assert.equal(retries.length, 1);
  assert.equal(retries[0].provider, 'voyage');
  assert.equal(retries[0].attempt, 1);
});

test('does not retry on 4xx other than 408/425/429', async () => {
  // 400 + no openai fallback means we expect a fail-fast against voyage.
  nock(VOYAGE_BASE).post(VOYAGE_PATH).reply(400, { error: 'bad request' });

  const { adapter, logger } = newAdapter({ openaiApiKey: undefined });
  await assert.rejects(adapter.embed('z'), EmbeddingsError);

  assert.equal(logger.byEvent('embedding_retry').length, 0);
});

test('caps at maxAttempts (3) then throws', async () => {
  nock(VOYAGE_BASE).post(VOYAGE_PATH).times(3).reply(503, 'unavailable');

  // No openai key → no fallback → original error surfaces.
  const { adapter, logger } = newAdapter({ openaiApiKey: undefined });
  await assert.rejects(adapter.embed('q'), EmbeddingsError);

  // 2 retries logged (attempts 1 and 2 each emit an embedding_retry; the 3rd
  // throws without retrying).
  assert.equal(logger.byEvent('embedding_retry').length, 2);
});

// ---------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------

test('falls back to openai when voyage exhausts retries', async () => {
  nock(VOYAGE_BASE).post(VOYAGE_PATH).times(3).reply(503, 'unavailable');
  nock(OPENAI_BASE)
    .post(OPENAI_PATH)
    .reply(200, openaiReply(['fallback']));

  const { adapter, logger } = newAdapter();
  const vec = await adapter.embed('fallback');

  assert.equal(vec.length, EMBEDDING_DIMENSIONS);
  const fallback = logger.byEvent('embedding_provider_fallback');
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].from, 'voyage');
  assert.equal(fallback[0].to, 'openai');
});

test('does not fall back when OPENAI_API_KEY is missing', async () => {
  nock(VOYAGE_BASE).post(VOYAGE_PATH).times(3).reply(503, 'down');

  const { adapter, logger } = newAdapter({ openaiApiKey: undefined });
  await assert.rejects(adapter.embed('q'), /voyage embeddings request failed/);

  assert.equal(logger.byEvent('embedding_provider_fallback').length, 0);
});

test('throws if both providers fail', async () => {
  nock(VOYAGE_BASE).post(VOYAGE_PATH).times(3).reply(503);
  nock(OPENAI_BASE).post(OPENAI_PATH).times(3).reply(503);

  const { adapter } = newAdapter();
  await assert.rejects(adapter.embed('boom'), /openai embeddings request failed/);
});

// ---------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------

test('cache hits skip the network entirely', async () => {
  // First call hits voyage and populates the cache.
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH)
    .reply(200, voyageReply(['cached']));

  const cache = new MemoryCache();
  const { adapter, logger } = newAdapter({ cache });
  const v1 = await adapter.embed('cached');
  assert.equal(cache.size(), 1);

  // No nock interceptor for the second call — if the adapter hits the
  // network, nock.disableNetConnect() will throw.
  const v2 = await adapter.embed('cached');
  assert.deepEqual(v2, v1);

  const hits = logger.byEvent('embedding_cache_hit');
  assert.ok(hits.some((h) => h.count === 1 && h.total === 1));
});

test('partial-hit batch: only misses hit the network', async () => {
  const cache = new MemoryCache();
  // Pre-populate cache with one entry under the active model id.
  const modelId = 'voyage-3-large@1024';
  await cache.set(cacheKeyFor(modelId, 'preheated'), modelId, makeVector(42));

  // The provider should only see the single missing input.
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH, (body) => body.input.length === 1 && body.input[0] === 'fresh')
    .reply(200, voyageReply(['fresh']));

  const { adapter, logger } = newAdapter({ cache });
  const vecs = await adapter.embedBatch(['preheated', 'fresh']);

  assert.equal(vecs.length, 2);
  assert.deepEqual(vecs[0], makeVector(42));
  assert.equal(vecs[1].length, EMBEDDING_DIMENSIONS);

  const hit = logger.byEvent('embedding_cache_hit')[0];
  const miss = logger.byEvent('embedding_cache_miss')[0];
  assert.equal(hit.count, 1);
  assert.equal(hit.total, 2);
  assert.equal(miss.count, 1);
  assert.equal(miss.total, 2);

  // Cache should now contain both.
  assert.equal(cache.size(), 2);
});

test('NullCache disables caching even with default constructor wiring', async () => {
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH)
    .times(2)
    .reply(200, voyageReply(['x']));

  const { adapter } = newAdapter({ cache: null });
  await adapter.embed('x');
  await adapter.embed('x'); // would be a hit if cache were active
  // If cache were on, the second call wouldn't hit the network and the
  // second nock interceptor would remain unused → nock.cleanAll() in afterEach
  // doesn't enforce that, so check explicitly:
  assert.equal(nock.pendingMocks().length, 0, 'second call should have hit the network');
});

// ---------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------

test('respects effective batch size (split across multiple provider calls)', async () => {
  // 5 inputs with batchSize=2 → 3 calls (2, 2, 1)
  let calls = 0;
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH)
    .times(3)
    .reply(200, function (uri, body) {
      calls += 1;
      return voyageReply(body.input);
    });

  const { adapter } = newAdapter();
  const vecs = await adapter.embedBatch(['a', 'b', 'c', 'd', 'e'], { batchSize: 2 });

  assert.equal(calls, 3);
  assert.equal(vecs.length, 5);
});

// ---------------------------------------------------------------------
// Reverse direction: provider=openai with voyage as fallback
// ---------------------------------------------------------------------

test('with provider=openai, falls back to voyage on openai failure', async () => {
  nock(OPENAI_BASE).post(OPENAI_PATH).times(3).reply(500);
  nock(VOYAGE_BASE)
    .post(VOYAGE_PATH)
    .reply(200, voyageReply(['x']));

  const { adapter, logger } = newAdapter({ provider: 'openai' });
  const vec = await adapter.embed('x');

  assert.equal(vec.length, EMBEDDING_DIMENSIONS);
  const fallback = logger.byEvent('embedding_provider_fallback')[0];
  assert.equal(fallback.from, 'openai');
  assert.equal(fallback.to, 'voyage');
});

// ---------------------------------------------------------------------
// Error body surfacing
// ---------------------------------------------------------------------

test('Voyage 4xx: error message includes the response body', async () => {
  const voyageBody = JSON.stringify({
    detail: 'invalid input at index 3: text exceeds 32000 token limit',
  });
  nock(VOYAGE_BASE).post(VOYAGE_PATH).reply(400, voyageBody);

  const { adapter } = newAdapter({ openaiApiKey: undefined });
  await assert.rejects(adapter.embed('oversized'), (err) => {
    assert.ok(err instanceof EmbeddingsError);
    assert.match(err.message, /voyage embeddings request failed \(400\)/);
    assert.match(err.message, /32000 token limit/, 'body must be in message');
    assert.equal(err.body, voyageBody, 'full body preserved on err.body');
    return true;
  });
});

test('Voyage error message truncates very long bodies (readable logs)', async () => {
  const bigBody = 'x'.repeat(10_000);
  nock(VOYAGE_BASE).post(VOYAGE_PATH).reply(400, bigBody);

  const { adapter } = newAdapter({ openaiApiKey: undefined });
  await assert.rejects(adapter.embed('x'), (err) => {
    assert.ok(err.message.length < 700, `expected truncation, got ${err.message.length} chars`);
    assert.equal(err.body.length, 10_000, 'full body still on err.body');
    return true;
  });
});

test('Voyage error with no body still produces a clean message', async () => {
  nock(VOYAGE_BASE).post(VOYAGE_PATH).reply(400, '');

  const { adapter } = newAdapter({ openaiApiKey: undefined });
  await assert.rejects(adapter.embed('x'), (err) => {
    assert.match(err.message, /voyage embeddings request failed \(400\)$/);
    assert.ok(!err.message.includes(' — body:'));
    return true;
  });
});
