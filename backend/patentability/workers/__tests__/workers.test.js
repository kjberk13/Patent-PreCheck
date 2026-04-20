'use strict';

// Per-worker pipeline tests: mock the source API via nock, use
// MemoryWorkerPersistence + a fake Embeddings, then run the worker
// end-to-end and assert on the upserted rows, run log, and cursor shape.

const test = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');

const { ArxivWorker, parseArxivEntries } = require('../arxiv_worker.js');
const { GitHubWorker } = require('../github_worker.js');
const { PatentsViewWorker } = require('../patentsview_worker.js');
const { MemoryWorkerPersistence } = require('../../../shared/worker_persistence.js');
const { SourceApiAuthError } = require('../../../shared/worker_errors.js');
const { EMBEDDING_DIMENSIONS } = require('../../../shared/embeddings.js');

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

function capturingLogger() {
  const events = [];
  return {
    fn: (level, event) => events.push({ level, ...event }),
    events,
    byEvent(name) {
      return events.filter((e) => e.event === name);
    },
  };
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

// =====================================================================
// arXiv
// =====================================================================

const ARXIV_FIXTURE = (ids) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  ${ids
    .map(
      (id, i) => `
  <entry>
    <id>http://arxiv.org/abs/${id}</id>
    <title>Paper ${i}: An Investigation of Useful Things</title>
    <summary>A clear and meaningful abstract for paper ${i} describing new results.</summary>
    <published>2024-06-0${(i % 9) + 1}T00:00:00Z</published>
    <link rel="alternate" type="text/html" href="http://arxiv.org/abs/${id}" />
    <author><name>Jane Doe</name></author>
    <category term="cs.LG" />
  </entry>`,
    )
    .join('\n')}
</feed>`;

test('arXiv worker: fetch → parse → embed → upsert → log', async () => {
  nock('http://export.arxiv.org')
    .get(/\/api\/query/)
    .reply(200, ARXIV_FIXTURE(['2406.0001', '2406.0002', '2406.0003']));
  nock('http://export.arxiv.org')
    .get(/\/api\/query/)
    .reply(200, ARXIV_FIXTURE([])); // empty → loop exits

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();

  const worker = new ArxivWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    pageSize: 10,
  });

  const result = await worker.run({ mode: 'backfill', limit: 3 });

  assert.equal(result.status, 'success');
  assert.equal(result.ingested, 3);
  assert.equal(persistence.getDocuments().length, 3);

  const doc = persistence.getDocuments()[0];
  assert.equal(doc.source_id, 'arxiv');
  assert.equal(doc.doc_type, 'paper');
  assert.ok(doc.title.length > 0);
  assert.equal(doc.embedding.length, EMBEDDING_DIMENSIONS);

  assert.equal(embeddings.calls.length, 1);
  assert.ok(embeddings.calls[0][0].includes('\n\n'), 'embedText joins title + abstract');

  const run = persistence.getRuns()[0];
  assert.equal(run.status, 'success');
  assert.equal(run.metadata.cursor.offset, 3);
});

test('parseArxivEntries is robust to empty / malformed input', () => {
  assert.deepEqual(parseArxivEntries(''), []);
  assert.deepEqual(parseArxivEntries(null), []);
  assert.deepEqual(parseArxivEntries('<feed></feed>'), []);
});

test('arXiv --dry-run fetches + parses but does not embed, upsert, or log-write', async () => {
  nock('http://export.arxiv.org')
    .get(/\/api\/query/)
    .reply(200, ARXIV_FIXTURE(['2406.0001', '2406.0002']));
  nock('http://export.arxiv.org')
    .get(/\/api\/query/)
    .reply(200, ARXIV_FIXTURE([]));

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();
  const worker = new ArxivWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    pageSize: 10,
  });
  const result = await worker.run({ mode: 'backfill', limit: 2, dryRun: true });

  assert.equal(result.ingested, 2);
  assert.equal(embeddings.calls.length, 0);
  assert.equal(persistence.getDocuments().length, 0);
  assert.equal(persistence.getRuns().length, 0);
  assert.equal(logger.byEvent('dry_run_batch').length, 1);
});

// =====================================================================
// GitHub
// =====================================================================

function githubFixture(ids) {
  return {
    total_count: ids.length,
    incomplete_results: false,
    items: ids.map((id, i) => ({
      id,
      full_name: `owner${i}/repo${i}`,
      description: `Description ${i} of something novel`,
      html_url: `https://github.com/owner${i}/repo${i}`,
      created_at: '2024-06-01T00:00:00Z',
      language: 'JavaScript',
      stargazers_count: 100 + i,
      topics: ['ai', 'llm'],
      default_branch: 'main',
    })),
  };
}

test('GitHub worker: fetch → parse → embed → upsert → log', async () => {
  nock('https://api.github.com')
    .get(/\/search\/repositories/)
    .reply(200, githubFixture([1001, 1002, 1003]));
  nock('https://api.github.com')
    .get(/\/search\/repositories/)
    .reply(200, githubFixture([]));

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();

  const worker = new GitHubWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    perPage: 10,
    token: 'gh-test-token',
  });

  const result = await worker.run({ mode: 'delta', limit: 3 });

  assert.equal(result.status, 'success');
  assert.equal(result.ingested, 3);

  const doc = persistence.getDocuments()[0];
  assert.equal(doc.source_id, 'github-search');
  assert.equal(doc.doc_type, 'repo');
  assert.equal(doc.metadata.stars, 100);
  assert.deepEqual(doc.metadata.topics, ['ai', 'llm']);
});

test('GitHub worker throws SourceApiAuthError before any request when GITHUB_TOKEN is missing', async () => {
  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();
  const worker = new GitHubWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    token: undefined,
  });

  await assert.rejects(() => worker.run({ mode: 'delta' }), (err) => {
    assert.ok(err instanceof SourceApiAuthError);
    assert.match(err.message, /check your GITHUB_TOKEN/);
    return true;
  });
  assert.equal(logger.byEvent('auth_failure').length, 1);
});

test('GitHub worker classifies 401 into SourceApiAuthError at HTTP level', async () => {
  nock('https://api.github.com')
    .get(/\/search\/repositories/)
    .reply(401, 'bad credentials');

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();
  const worker = new GitHubWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    maxHttpAttempts: 1,
    token: 'gh-test-token',
  });

  await assert.rejects(
    () => worker.run({ mode: 'delta' }),
    (err) => err instanceof SourceApiAuthError,
  );
  assert.equal(logger.byEvent('auth_failure').length, 1);
});

test('GitHub worker retries 503 then succeeds', async () => {
  nock('https://api.github.com')
    .get(/\/search\/repositories/)
    .reply(503, 'unavailable')
    .get(/\/search\/repositories/)
    .reply(200, githubFixture([2001]))
    .get(/\/search\/repositories/)
    .reply(200, githubFixture([]));

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();
  const worker = new GitHubWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    perPage: 5,
    token: 'gh-test-token',
  });

  const result = await worker.run({ mode: 'delta', limit: 1 });
  assert.equal(result.ingested, 1);
  assert.equal(logger.byEvent('http_retry').length, 1);
});

// =====================================================================
// PatentsView
// =====================================================================

function pvFixture(ids) {
  return {
    patents: ids.map((id, i) => ({
      patent_id: String(id),
      patent_title: `Method and System for ${id}`,
      patent_abstract: `Abstract describing patent ${id} in detail.`,
      patent_date: '2024-06-01',
      cpc_current: [{ cpc_group_id: 'G06F' }],
      assignees: [{ assignee_organization: `Co ${i}` }],
    })),
    count: ids.length,
    total_hits: ids.length,
  };
}

test('PatentsView worker: fetch → parse → embed → upsert → log', async () => {
  // The worker must send the API key as X-Api-Key on every request.
  nock('https://search.patentsview.org', {
    reqheaders: { 'x-api-key': 'uspto-test-key' },
  })
    .post('/api/v1/patent/')
    .reply(200, pvFixture([11000001, 11000002, 11000003]));
  nock('https://search.patentsview.org', {
    reqheaders: { 'x-api-key': 'uspto-test-key' },
  })
    .post('/api/v1/patent/')
    .reply(200, pvFixture([]));

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();

  const worker = new PatentsViewWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    pageSize: 10,
    apiKey: 'uspto-test-key',
  });

  const result = await worker.run({ mode: 'delta', limit: 3 });

  assert.equal(result.status, 'success');
  assert.equal(result.ingested, 3);

  const docs = persistence.getDocuments();
  assert.equal(docs[0].source_id, 'uspto-patentsview');
  assert.equal(docs[0].doc_type, 'patent');
  assert.match(docs[0].url, /patents\.google\.com\/patent\/US/);

  const run = persistence.getRuns()[0];
  assert.equal(run.metadata.cursor.lastPatentId, '11000003');
});

test('PatentsView worker throws SourceApiAuthError when USPTO_API_KEY is missing', async () => {
  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();
  const worker = new PatentsViewWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    apiKey: null,
  });

  await assert.rejects(
    () => worker.run({ mode: 'delta' }),
    (err) => {
      assert.ok(err instanceof SourceApiAuthError);
      assert.match(err.message, /check your USPTO_API_KEY/);
      assert.match(err.message, /developer\.uspto\.gov/);
      return true;
    },
  );
  assert.equal(logger.byEvent('auth_failure').length, 1);
});

test('PatentsView worker surfaces a migration hint on HTTP 410', async () => {
  nock('https://search.patentsview.org')
    .post('/api/v1/patent/')
    .reply(410, 'Gone — endpoint retired');

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();
  const worker = new PatentsViewWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    maxHttpAttempts: 1, // 410 is permanent anyway, but keep the test fast
    apiKey: 'uspto-test-key',
  });

  await assert.rejects(
    () => worker.run({ mode: 'delta' }),
    (err) => {
      assert.match(err.message, /HTTP 410 Gone/);
      assert.match(err.message, /PATENTSVIEW_ENDPOINT/);
      assert.match(err.message, /developer\.uspto\.gov/);
      return true;
    },
  );
});
