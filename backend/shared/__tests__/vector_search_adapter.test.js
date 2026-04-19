'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { VectorSearchAdapter, neonRunQuery, poolRunQuery } = require('../vector_search_adapter.js');
const { EMBEDDING_DIMENSIONS } = require('../embeddings.js');

// ---------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------

function makeVector(seed) {
  const v = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) v[i] = ((i * seed) % 100) / 100;
  return v;
}

class FakeEmbeddings {
  constructor() {
    this.calls = [];
  }
  async embedBatch(texts) {
    this.calls.push(texts);
    return texts.map((_, i) => makeVector(i + 1));
  }
}

function fakeRegistry(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return {
    listAll: () => [...byId.values()],
    listImplemented: () => [...byId.values()].filter((e) => e.status === 'implemented'),
    getEntry: (id) => byId.get(id) || null,
  };
}

function capturingRunQuery(rows) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    return rows;
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------
// Core behaviour
// ---------------------------------------------------------------------

test('search() embeds the query and returns weighted results in descending order', async () => {
  const registry = fakeRegistry([
    { id: 'uspto-patentsview', tier: 'A', status: 'implemented' },
    { id: 'github-search', tier: 'C', status: 'implemented' },
  ]);
  const runQuery = capturingRunQuery([
    {
      source_id: 'uspto-patentsview',
      native_id: '1',
      doc_type: 'patent',
      title: 'Patent A',
      abstract: 'abstract A',
      url: 'http://a',
      published_at: '2024-01-01',
      similarity: 0.8,
    },
    {
      source_id: 'github-search',
      native_id: '2',
      doc_type: 'repo',
      title: 'Repo B',
      abstract: 'abstract B',
      url: 'http://b',
      published_at: '2024-02-01',
      similarity: 0.9,
    },
  ]);

  const adapter = new VectorSearchAdapter({
    embeddings: new FakeEmbeddings(),
    runQuery,
    registry,
    logger: () => {},
  });

  // Weight A higher than C so Patent A should leapfrog Repo B.
  const results = await adapter.search({
    query: 'quantum widget',
    limit: 5,
    source_tiers: ['A', 'C'],
    source_weights: { A: 2.0, C: 0.5 },
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Patent A', 'A-tier wins after weighting');
  // Weighted: A = 0.8 * 2.0 = 1.6; C = 0.9 * 0.5 = 0.45
  assert.ok(results[0].similarity_score > results[1].similarity_score);
  assert.equal(results[0].source_tier, 'A');
  assert.equal(results[1].source_tier, 'C');
  assert.equal(results[0].snippet, 'abstract A');
});

test('search() filters source_tiers against implemented workers only', async () => {
  const registry = fakeRegistry([
    { id: 'uspto-patentsview', tier: 'A', status: 'implemented' },
    { id: 'uspto-peds', tier: 'A', status: 'planned' },
    { id: 'github-search', tier: 'C', status: 'implemented' },
  ]);
  const runQuery = capturingRunQuery([]);
  const adapter = new VectorSearchAdapter({
    embeddings: new FakeEmbeddings(),
    runQuery,
    registry,
    logger: () => {},
  });

  await adapter.search({
    query: 'x',
    source_tiers: ['A'],
    source_weights: { A: 1 },
  });

  assert.equal(runQuery.calls.length, 1);
  const [, params] = [runQuery.calls[0].sql, runQuery.calls[0].params];
  const sourceIds = params[1];
  assert.deepEqual(sourceIds, ['uspto-patentsview']);
});

test('search() with no tier filter uses every implemented source', async () => {
  const registry = fakeRegistry([
    { id: 'uspto-patentsview', tier: 'A', status: 'implemented' },
    { id: 'arxiv', tier: 'B', status: 'implemented' },
    { id: 'github-search', tier: 'C', status: 'implemented' },
    { id: 'semantic-scholar', tier: 'B', status: 'planned' },
  ]);
  const runQuery = capturingRunQuery([]);
  const adapter = new VectorSearchAdapter({
    embeddings: new FakeEmbeddings(),
    runQuery,
    registry,
    logger: () => {},
  });

  await adapter.search({ query: 'x' });
  const sourceIds = runQuery.calls[0].params[1];
  assert.deepEqual(sourceIds.sort(), ['arxiv', 'github-search', 'uspto-patentsview']);
});

test('search() returns [] with a warning when no implemented sources match the tiers', async () => {
  const registry = fakeRegistry([{ id: 'uspto-patentsview', tier: 'A', status: 'implemented' }]);
  const logEvents = [];
  const adapter = new VectorSearchAdapter({
    embeddings: new FakeEmbeddings(),
    runQuery: capturingRunQuery([]),
    registry,
    logger: (level, e) => logEvents.push({ level, ...e }),
  });

  const result = await adapter.search({ query: 'x', source_tiers: ['Z'] });
  assert.deepEqual(result, []);
  assert.ok(logEvents.some((e) => e.event === 'vector_search_no_sources'));
});

test('search() limits the result to the requested size after reweighing', async () => {
  const registry = fakeRegistry([{ id: 'uspto-patentsview', tier: 'A', status: 'implemented' }]);
  const rows = Array.from({ length: 8 }, (_, i) => ({
    source_id: 'uspto-patentsview',
    native_id: String(i),
    doc_type: 'patent',
    title: `P${i}`,
    abstract: '',
    url: null,
    published_at: null,
    similarity: 0.5 + i * 0.01,
  }));
  const adapter = new VectorSearchAdapter({
    embeddings: new FakeEmbeddings(),
    runQuery: capturingRunQuery(rows),
    registry,
    logger: () => {},
  });
  const results = await adapter.search({ query: 'x', limit: 3 });
  assert.equal(results.length, 3);
});

test('search() throws on an empty query', async () => {
  const registry = fakeRegistry([]);
  const adapter = new VectorSearchAdapter({
    embeddings: new FakeEmbeddings(),
    runQuery: capturingRunQuery([]),
    registry,
  });
  await assert.rejects(() => adapter.search({ query: '' }), /non-empty query/);
});

// ---------------------------------------------------------------------
// Adapter wrappers
// ---------------------------------------------------------------------

test('neonRunQuery wraps the neon() sql() function', async () => {
  const captured = [];
  const fakeNeon = async (text, params) => {
    captured.push({ text, params });
    return [{ a: 1 }];
  };
  const run = neonRunQuery(fakeNeon);
  const rows = await run('SELECT 1', [42]);
  assert.deepEqual(rows, [{ a: 1 }]);
  assert.equal(captured[0].text, 'SELECT 1');
  assert.deepEqual(captured[0].params, [42]);
});

test('neonRunQuery unwraps a {rows: [...]} response from future driver versions', async () => {
  const fakeNeon = async () => ({ rows: [{ b: 2 }] });
  const run = neonRunQuery(fakeNeon);
  const rows = await run('SELECT 1');
  assert.deepEqual(rows, [{ b: 2 }]);
});

test('poolRunQuery returns only .rows from pg.Pool.query()', async () => {
  const fakePool = {
    query: async (text, params) => ({
      rows: [{ hit: true, text, paramCount: params.length }],
    }),
  };
  const run = poolRunQuery(fakePool);
  const rows = await run('SELECT $1', [99]);
  assert.equal(rows[0].hit, true);
  assert.equal(rows[0].paramCount, 1);
});
