'use strict';

// Per-worker pipeline tests: mock the source API via nock, use
// MemoryWorkerPersistence + a fake Embeddings, then run the worker
// end-to-end and assert on the upserted rows, run log, and cursor shape.

const test = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');

const { ArxivWorker, parseArxivEntries, looksLikeArxivFeed } = require('../arxiv_worker.js');
const { GitHubWorker } = require('../github_worker.js');
const { PatentsViewWorker, isEmptyResultBody } = require('../patentsview_worker.js');
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
// USPTO Open Data Portal
// =====================================================================

// ODP canonical response shape (verified via Swagger UI):
//   - Top-level `patentFileWrapperDataBag` (primary wrapper) OR
//     `patentBag` / `applications` depending on endpoint.
//   - Each item has `applicationNumberText` at top level and nested
//     metadata under `applicationMetaData`.
function odpFixture(ids) {
  return {
    patentFileWrapperDataBag: ids.map((id, i) => ({
      applicationNumberText: String(id),
      applicationMetaData: {
        inventionTitle: `Method and System for ${id}`,
        inventionAbstractText: `Abstract describing application ${id} in detail.`,
        filingDate: '2024-06-01',
        applicationTypeLabelName: 'Utility',
        applicationStatusDescriptionText: 'Patented Case',
        cpcClassificationBag: [`G06F7/${i.toString().padStart(2, '0')}`],
        applicantBag: [{ applicantNameText: `Co ${i}` }],
      },
    })),
  };
}

test('USPTO ODP worker: POSTs canonical Swagger schema with X-Api-Key', async () => {
  let capturedBody = null;
  nock('https://api.uspto.gov', {
    reqheaders: { 'x-api-key': 'uspto-test-key' },
  })
    .post('/api/v1/patent/applications/search', (body) => {
      capturedBody = body;
      return true;
    })
    .reply(200, odpFixture([11000001, 11000002, 11000003]));
  nock('https://api.uspto.gov', {
    reqheaders: { 'x-api-key': 'uspto-test-key' },
  })
    .post('/api/v1/patent/applications/search')
    .reply(200, odpFixture([]));

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
  assert.equal(docs[0].title, 'Method and System for 11000001');
  assert.match(docs[0].abstract, /Abstract describing application 11000001/);
  assert.equal(docs[0].metadata.application_type, 'Utility');
  assert.equal(docs[0].metadata.status, 'Patented Case');
  assert.equal(docs[0].metadata.had_abstract, true);

  const run = persistence.getRuns()[0];
  assert.equal(run.metadata.cursor.offset, 3);

  // The request body must match the ODP canonical schema.
  assert.ok(capturedBody, 'request body captured by nock interceptor');
  assert.equal(typeof capturedBody.q, 'string', 'q is a string');
  // CPC is queried directly against the bag string-array (no sub-key);
  // the previous `cpcClassificationBag.cpcSymbolText` path matched
  // nothing because the bag is an array of plain strings.
  assert.match(capturedBody.q, /applicationMetaData\.cpcClassificationBag:\(G06F\*/);
  // Utility type lives in filters[] per ODP canonical shape (multi-
  // value OR via the `value` array), not stuffed into q.
  assert.equal(capturedBody.filters.length, 1);
  assert.equal(capturedBody.filters[0].name, 'applicationMetaData.applicationTypeLabelName');
  assert.deepEqual(capturedBody.filters[0].value, ['Utility']);
  assert.equal(capturedBody.rangeFilters[0].field, 'applicationMetaData.filingDate');
  assert.ok(capturedBody.rangeFilters[0].valueFrom, 'rangeFilters.valueFrom present');
  assert.ok(capturedBody.rangeFilters[0].valueTo, 'rangeFilters.valueTo present');
  assert.equal(capturedBody.sort[0].field, 'applicationMetaData.filingDate');
  assert.equal(capturedBody.sort[0].order, 'asc');
  assert.equal(capturedBody.pagination.offset, 0);
  assert.equal(capturedBody.pagination.limit, 10);
});

test('USPTO ODP worker: parseDocument reads from applicationMetaData (nested ODP shape)', () => {
  const worker = new PatentsViewWorker({
    persistence: new MemoryWorkerPersistence(),
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    apiKey: 'x',
  });
  const doc = worker.parseDocument({
    applicationNumberText: '17/123,456',
    applicationMetaData: {
      inventionTitle: 'Neural Widget',
      inventionAbstractText: 'A method for widget embedding via neural nets.',
      filingDate: '2023-04-15',
      applicationTypeLabelName: 'Utility',
      applicationStatusDescriptionText: 'Patented Case',
      cpcClassificationBag: ['G06N3/08', 'G06N3/04'],
      applicantBag: [{ applicantNameText: 'Widget Corp' }],
    },
  });
  assert.equal(doc.native_id, '17/123,456');
  assert.equal(doc.title, 'Neural Widget');
  assert.match(doc.abstract, /widget embedding/);
  assert.equal(doc.published_at, '2023-04-15');
  assert.equal(doc.metadata.application_type, 'Utility');
  assert.equal(doc.metadata.had_abstract, true);
  // cpcClassificationBag is an array of plain strings per ODP Swagger.
  assert.deepEqual(doc.metadata.cpc_classifications, ['G06N3/08', 'G06N3/04']);
});

test('USPTO ODP worker: parseDocument tries abstractBag fallback for nested text', () => {
  const worker = new PatentsViewWorker({
    persistence: new MemoryWorkerPersistence(),
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    apiKey: 'x',
  });
  // Some ODP endpoints expose abstract as a nested "bag" instead of a
  // flat text field. Parser should dig into it.
  const doc = worker.parseDocument({
    applicationNumberText: '17/999,000',
    applicationMetaData: {
      inventionTitle: 'Bagged Abstract',
      filingDate: '2024-01-01',
      abstractBag: [{ abstractTextBagItem: [{ text: 'Abstract from a nested bag.' }] }],
    },
  });
  assert.match(doc.abstract, /nested bag/);
  assert.equal(doc.metadata.had_abstract, true);
});

test('USPTO ODP worker: parseDocument falls back to title-only when abstract is absent', () => {
  const worker = new PatentsViewWorker({
    persistence: new MemoryWorkerPersistence(),
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    apiKey: 'x',
  });
  // Verify the worker ingests successfully even if USPTO's search
  // response omits abstract text (a likely real-world situation).
  const doc = worker.parseDocument({
    applicationNumberText: '17/111,222',
    applicationMetaData: {
      inventionTitle: 'Title-only Widget',
      filingDate: '2024-01-01',
    },
  });
  assert.equal(doc.title, 'Title-only Widget');
  assert.equal(doc.abstract, null);
  assert.equal(doc.metadata.had_abstract, false);
  assert.equal(doc.embedText, 'Title-only Widget');
});

test('USPTO ODP worker: parseDocument still parses legacy PatentsView field names', () => {
  // Defensive — if any cached/alt response still uses PatentsView-style
  // keys, we don't hard-fail.
  const worker = new PatentsViewWorker({
    persistence: new MemoryWorkerPersistence(),
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    apiKey: 'x',
  });
  const doc = worker.parseDocument({
    patent_id: '99999999',
    patent_title: 'Legacy Title',
    patent_abstract: 'Legacy abstract.',
    patent_date: '2020-01-01',
    cpc_current: [{ cpc_group_id: 'G06N' }],
    assignees: [{ assignee_organization: 'Acme' }],
  });
  assert.equal(doc.native_id, '99999999');
  assert.equal(doc.title, 'Legacy Title');
  assert.equal(doc.published_at, '2020-01-01');
});

test('USPTO ODP worker: honours USPTO_ODP_ENDPOINT override', async () => {
  nock('https://custom.uspto.example', {
    reqheaders: { 'x-api-key': 'k' },
  })
    .post('/v2/search')
    .reply(200, odpFixture([]));

  const worker = new PatentsViewWorker({
    persistence: new MemoryWorkerPersistence(),
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    apiKey: 'k',
    endpoint: 'https://custom.uspto.example/v2/search',
  });
  const result = await worker.run({ mode: 'delta' });
  assert.equal(result.status, 'success');
});

test('USPTO ODP worker: customQuery override bypasses the default q builder', async () => {
  let capturedBody = null;
  nock('https://api.uspto.gov', {
    reqheaders: { 'x-api-key': 'k' },
  })
    .post('/api/v1/patent/applications/search', (body) => {
      capturedBody = body;
      return true;
    })
    .reply(200, odpFixture([]));

  const worker = new PatentsViewWorker({
    persistence: new MemoryWorkerPersistence(),
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    apiKey: 'k',
    customQuery: 'applicationMetaData.applicationTypeLabelName:Design',
  });
  await worker.run({ mode: 'delta' });
  assert.equal(capturedBody.q, 'applicationMetaData.applicationTypeLabelName:Design');
});

test('USPTO ODP worker throws SourceApiAuthError when USPTO_API_KEY is missing', async () => {
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
      assert.match(err.message, /data\.uspto\.gov/);
      return true;
    },
  );
  assert.equal(logger.byEvent('auth_failure').length, 1);
});

test('USPTO ODP worker surfaces a migration hint on HTTP 410', async () => {
  nock('https://api.uspto.gov')
    .post('/api/v1/patent/applications/search')
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
      assert.match(err.message, /USPTO_ODP_ENDPOINT/);
      assert.match(err.message, /data\.uspto\.gov/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------
// USPTO ODP — HTTP 404 empty-result handling
// ---------------------------------------------------------------------

const ODP_EMPTY_BODY = JSON.stringify({
  code: '404',
  message: 'Not Found',
  detailedMessage: 'No matching records found, refine your search criteria and try again',
});

test('isEmptyResultBody recognises the ODP no-match signal (and rejects unrelated 404s)', () => {
  assert.equal(isEmptyResultBody(ODP_EMPTY_BODY), true);
  assert.equal(isEmptyResultBody(''), false);
  assert.equal(isEmptyResultBody('<html>Not Found</html>'), false);
  assert.equal(isEmptyResultBody(null), false);
});

test('USPTO ODP worker: HTTP 404 with "No matching records" ends the run as success-with-0-docs', async () => {
  nock('https://api.uspto.gov')
    .post('/api/v1/patent/applications/search')
    .reply(404, ODP_EMPTY_BODY, { 'content-type': 'application/json' });

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();
  const worker = new PatentsViewWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    apiKey: 'uspto-test-key',
    maxHttpAttempts: 1,
  });

  const result = await worker.run({ mode: 'delta' });

  assert.equal(result.status, 'success', 'run must finish as success');
  assert.equal(result.ingested, 0);
  assert.equal(result.skipped, 0);

  const emptyEvents = logger.byEvent('uspto_empty_result_set');
  assert.equal(emptyEvents.length, 1, 'empty-result info event must fire exactly once');

  const runs = persistence.getRuns();
  assert.equal(runs[0].status, 'success');
  assert.equal(runs[0].docs_ingested, 0);
});

test('USPTO ODP worker: HTTP 404 WITHOUT the empty-result signal still propagates as a real error', async () => {
  nock('https://api.uspto.gov')
    .post('/api/v1/patent/applications/search')
    .reply(404, '<html>404 Not Found — wrong URL</html>');

  const worker = new PatentsViewWorker({
    persistence: new MemoryWorkerPersistence(),
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    apiKey: 'k',
    maxHttpAttempts: 1,
  });

  await assert.rejects(
    () => worker.run({ mode: 'delta' }),
    (err) => /permanent HTTP 404/.test(err.message),
  );
});

// ---------------------------------------------------------------------
// arXiv — HTTP 500 with valid feed body (known upstream quirk)
// ---------------------------------------------------------------------

const ARXIV_VALID_500_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Search Results</title>
  <opensearch:itemsPerPage>1</opensearch:itemsPerPage>
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2501.99999</id>
    <title>Quirky 500 Paper</title>
    <summary>Abstract of a paper that came back on a 500 response.</summary>
    <published>2025-01-15T00:00:00Z</published>
    <link rel="alternate" href="http://arxiv.org/abs/2501.99999"/>
    <author><name>A. Author</name></author>
    <category term="cs.LG"/>
  </entry>
</feed>`;

test('looksLikeArxivFeed recognises a real feed and rejects lookalikes', () => {
  assert.equal(looksLikeArxivFeed(ARXIV_VALID_500_BODY), true);
  // Missing opensearch marker → not an arxiv feed
  assert.equal(
    looksLikeArxivFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"/>`),
    false,
  );
  // Plain HTML 500 page
  assert.equal(looksLikeArxivFeed('<html><body>500 Internal Server Error</body></html>'), false);
  assert.equal(looksLikeArxivFeed(''), false);
  assert.equal(looksLikeArxivFeed(null), false);
});

test('arXiv worker: HTTP 500 with valid feed body is treated as success', async () => {
  nock('http://export.arxiv.org')
    .get(/\/api\/query/)
    .reply(500, ARXIV_VALID_500_BODY, { 'content-type': 'application/atom+xml' });
  // Empty follow-up ends pagination cleanly.
  nock('http://export.arxiv.org')
    .get(/\/api\/query/)
    .reply(200, '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>');

  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = capturingLogger();
  const worker = new ArxivWorker({
    persistence,
    embeddings,
    logger: logger.fn,
    sleep: () => Promise.resolve(),
    pageSize: 10,
    // With default retry=3 we'd hit the 500 mock 3 times; using 1 forces
    // the arxiv-specific recovery path on the first failure.
    maxHttpAttempts: 1,
  });

  const result = await worker.run({ mode: 'backfill', limit: 1 });

  assert.equal(result.status, 'success');
  assert.equal(result.ingested, 1);
  const recovery = logger.byEvent('arxiv_500_with_valid_feed');
  assert.equal(recovery.length, 1, 'recovery event must fire once');
  assert.equal(persistence.getDocuments()[0].title, 'Quirky 500 Paper');
});

test('arXiv worker: HTTP 500 with garbage body still fails (no false-positive recovery)', async () => {
  nock('http://export.arxiv.org')
    .get(/\/api\/query/)
    .reply(500, '<html><body>500 Internal Server Error</body></html>');

  const worker = new ArxivWorker({
    persistence: new MemoryWorkerPersistence(),
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    maxHttpAttempts: 1,
  });
  await assert.rejects(
    () => worker.run({ mode: 'backfill', limit: 1 }),
    (err) => /transient HTTP 500/.test(err.message),
  );
});

// ---------------------------------------------------------------------
// Error body preservation
// ---------------------------------------------------------------------

test('classifyHttpError preserves full response body on .body even when message is truncated', () => {
  const { classifyHttpError } = require('../../../shared/worker_errors.js');
  const big = 'x'.repeat(5_000);
  const err = classifyHttpError(500, big, 'src');
  assert.equal(err.body.length, 5_000, 'full body preserved on .body');
  assert.ok(err.message.length < 700, 'message still truncated for readability');
});
