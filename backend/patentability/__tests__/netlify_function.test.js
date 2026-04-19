'use strict';

// End-to-end pipeline test for the Netlify analyze function.
// Stubs out the network boundary with nock for Anthropic + Voyage, and
// the Neon/pg boundary with an in-process query function that returns
// fixture rows against a captured SQL param.
//
// The Neon module itself is loaded from node_modules and would make real
// network calls without intervention. We short-circuit it by replacing
// require.cache BEFORE requiring the function under test.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const nock = require('nock');

const { EMBEDDING_DIMENSIONS } = require('../../shared/embeddings.js');

// ---------------------------------------------------------------------
// Neon module substitution
// ---------------------------------------------------------------------
// The netlify function imports `neon` from '@neondatabase/serverless'.
// In tests we swap it for a capturing fake that yields fixture rows.

const neonFake = {
  enabled: false,
  lastDatabaseUrl: null,
  rowsToReturn: [],
  calls: [],
  neon(databaseUrl) {
    neonFake.lastDatabaseUrl = databaseUrl;
    const sqlFn = async (text, params) => {
      neonFake.calls.push({ text, params });
      return neonFake.rowsToReturn;
    };
    return sqlFn;
  },
};

const neonModulePath = require.resolve('@neondatabase/serverless');
require.cache[neonModulePath] = {
  id: neonModulePath,
  filename: neonModulePath,
  loaded: true,
  exports: {
    neon: (url) => neonFake.neon(url),
  },
};

// Now require the function under test (will pick up our stubbed neon).
const { handler } = require('../netlify_function.js');

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function makeEmbedding(seed) {
  const v = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) v[i] = ((i * seed) % 100) / 100;
  return v;
}

const SAMPLE_CODE = `function generateEmbedding(text) {
  const tokenized = tokenize(text);
  return model.forward(tokenized);
}

// A novel transformer for multimodal embeddings.
`;

function mockAnthropicReturning({ summary, score }) {
  // The function makes two Anthropic calls in sequence:
  //   1. buildInventionSummary → returns summary text
  //   2. scorePatentability → returns a JSON-scored response
  nock('https://api.anthropic.com')
    .post('/v1/messages')
    .reply(200, {
      id: 'msg_summary',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: summary }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 200 },
    })
    .post('/v1/messages')
    .reply(200, {
      id: 'msg_score',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(score) }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
}

function mockVoyageOnce() {
  nock('https://api.voyageai.com')
    .post('/v1/embeddings')
    .reply(200, {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: makeEmbedding(7) }],
      model: 'voyage-3-large',
      usage: { total_tokens: 50 },
    });
}

function scoringResponse(pillarScoreOverrides = {}) {
  const base = { eligibility: 75, novelty: 72, non_obvious: 68, utility: 85, filing_readiness: 65 };
  const p = { ...base, ...pillarScoreOverrides };
  return {
    gate_passed: true,
    gate_reason: '',
    subject_matter_category: 'process',
    pillars: {
      eligibility: { score: p.eligibility, finding: 'ok', opportunity: 'strengthen' },
      novelty: { score: p.novelty, finding: 'ok', opportunity: 'strengthen' },
      non_obvious: { score: p.non_obvious, finding: 'ok', opportunity: 'strengthen' },
      utility: { score: p.utility, finding: 'ok', opportunity: 'strengthen' },
      filing_readiness: { score: p.filing_readiness, finding: 'ok', opportunity: 'strengthen' },
    },
    top_strengths: ['concrete technical result'],
    top_opportunities: [
      { pillar: 'non_obvious', action: 'cite prior art dissimilarities', impact: 'high' },
    ],
    technology_domain: 'Machine Learning',
    ai_contribution_level: 'high',
    summary: 'Forward-looking patentability position.',
  };
}

function priorArtRow(i, overrides = {}) {
  return {
    source_id: 'arxiv',
    native_id: `paper-${i}`,
    doc_type: 'paper',
    title: `Paper ${i}: Attention-based embeddings`,
    abstract: `This paper introduces novel attention mechanisms for token ${i}.`,
    url: `http://arxiv.org/abs/2406.000${i}`,
    published_at: '2024-06-01',
    similarity: 0.85 - i * 0.05,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------

test.beforeEach(() => {
  nock.cleanAll();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();

  neonFake.enabled = true;
  neonFake.lastDatabaseUrl = null;
  neonFake.calls = [];
  neonFake.rowsToReturn = [];

  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.VOYAGE_API_KEY = 'test-voyage';
  process.env.DATABASE_URL = 'postgresql://test:test@test.neon.tech/db?sslmode=require';
  process.env.DATABASE_URL_POOLED =
    'postgresql://test:test@test-pooler.neon.tech/db?sslmode=require';
  process.env.EMBEDDING_PROVIDER = 'voyage';
  process.env.EMBEDDING_MODEL = 'voyage-3-large';
});

test.afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

test('400 on missing code', async () => {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify({}) });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /at least 10 characters/);
});

test('OPTIONS preflight returns 200 with CORS headers', async () => {
  const res = await handler({ httpMethod: 'OPTIONS' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

test('405 on non-POST methods', async () => {
  const res = await handler({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('500 when ANTHROPIC_API_KEY is missing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE }),
  });
  assert.equal(res.statusCode, 500);
});

test('free tier: returns score + prior_art_match_count, no prior_art_matches', async () => {
  neonFake.rowsToReturn = [priorArtRow(1), priorArtRow(2), priorArtRow(3)];
  mockAnthropicReturning({
    summary: 'Embedding summary of the invention goes here.',
    score: scoringResponse(),
  });
  mockVoyageOnce();

  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE, tier: 'free' }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);

  // Score fields preserved
  assert.equal(body.gate_passed, true);
  assert.equal(typeof body.patentability_score, 'number');
  assert.equal(typeof body.filing_readiness_score, 'number');

  // Tier-gated prior art
  assert.equal(body.tier, 'free');
  assert.equal(body.prior_art_match_count, 3);
  assert.equal(body.prior_art_matches, undefined, 'free tier must NOT expose the list');
  assert.equal(typeof body.invention_summary, 'string');
  assert.ok(body.invention_summary.length > 0);
});

test('paid_review tier: returns the list with title, source, similarity', async () => {
  neonFake.rowsToReturn = [priorArtRow(1), priorArtRow(2)];
  mockAnthropicReturning({
    summary: 'Summary.',
    score: scoringResponse(),
  });
  mockVoyageOnce();

  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE, tier: 'paid_review' }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.tier, 'paid_review');
  assert.equal(body.prior_art_match_count, 2);
  assert.ok(Array.isArray(body.prior_art_matches));
  assert.equal(body.prior_art_matches.length, 2);
  assert.equal(typeof body.prior_art_matches[0].title, 'string');
  assert.equal(typeof body.prior_art_matches[0].similarity, 'number');
  assert.equal(typeof body.prior_art_matches[0].snippet, 'string');
});

test('unknown tier string normalises to free (trust-the-client guard)', async () => {
  neonFake.rowsToReturn = [priorArtRow(1)];
  mockAnthropicReturning({ summary: 'S', score: scoringResponse() });
  mockVoyageOnce();

  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE, tier: 'god_mode' }),
  });
  const body = JSON.parse(res.body);
  assert.equal(body.tier, 'free');
  assert.equal(body.prior_art_matches, undefined);
});

test('zero prior art rows → succeeds with prior_art_match_count: 0', async () => {
  neonFake.rowsToReturn = [];
  mockAnthropicReturning({ summary: 'S', score: scoringResponse() });
  mockVoyageOnce();

  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE, tier: 'paid_review' }),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.prior_art_match_count, 0);
  assert.equal(body.prior_art_matches, undefined, 'omit list when there are zero hits');
});

test('missing DATABASE_URL → scoring still runs (graceful degradation)', async () => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_POOLED;
  mockAnthropicReturning({ summary: 'S', score: scoringResponse() });
  // no voyage mock — without a vector store we skip the embed call

  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE, tier: 'free' }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.prior_art_match_count, 0);
  assert.equal(typeof body.patentability_score, 'number');
});

test('SQL uses tier-resolved source_ids (A+C for free tier)', async () => {
  neonFake.rowsToReturn = [priorArtRow(1)];
  mockAnthropicReturning({ summary: 'S', score: scoringResponse() });
  mockVoyageOnce();

  await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE, tier: 'free' }),
  });

  assert.ok(neonFake.calls.length > 0, 'Neon sql() must have been called');
  const [, params] = [neonFake.calls[0].text, neonFake.calls[0].params];
  const sourceIds = params[1];
  assert.ok(Array.isArray(sourceIds), 'second SQL param is the source_id array');
  assert.ok(sourceIds.includes('uspto-patentsview'), 'free tier should include A tier');
  assert.ok(sourceIds.includes('github-search'), 'free tier should include C tier');
  assert.ok(!sourceIds.includes('arxiv'), 'free tier must NOT include B tier');
});

test('paid_review SQL pulls from every implemented tier', async () => {
  neonFake.rowsToReturn = [priorArtRow(1)];
  mockAnthropicReturning({ summary: 'S', score: scoringResponse() });
  mockVoyageOnce();

  await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE, tier: 'paid_review' }),
  });

  const sourceIds = neonFake.calls[0].params[1];
  assert.ok(sourceIds.includes('arxiv'), 'paid_review should include B tier');
  assert.ok(sourceIds.includes('github-search'));
  assert.ok(sourceIds.includes('uspto-patentsview'));
});

test('prefers DATABASE_URL_POOLED over DATABASE_URL', async () => {
  neonFake.rowsToReturn = [];
  mockAnthropicReturning({ summary: 'S', score: scoringResponse() });
  mockVoyageOnce();

  await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ code: SAMPLE_CODE, tier: 'free' }),
  });

  assert.match(neonFake.lastDatabaseUrl, /-pooler\./, 'must use the pooled endpoint when set');
});
