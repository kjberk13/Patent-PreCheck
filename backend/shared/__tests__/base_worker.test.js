'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BaseWorker } = require('../base_worker.js');
const { MemoryWorkerPersistence } = require('../worker_persistence.js');
const {
  DocumentValidationError,
  SourceApiAuthError,
  SourceApiPermanentError,
  SourceApiTransientError,
  SourceSchemaError,
  WorkerLockError,
  CursorStaleError,
  EmbeddingError,
  classifyHttpError,
} = require('../worker_errors.js');
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
  constructor({ throwOnBatch } = {}) {
    this.throwOnBatch = throwOnBatch;
    this.calls = [];
  }
  async embedBatch(texts) {
    this.calls.push(texts);
    if (this.throwOnBatch) throw this.throwOnBatch;
    return texts.map((_, i) => makeVector(i + 1));
  }
}

class CapturingLogger {
  constructor() {
    this.events = [];
  }
  fn = (level, event) => this.events.push({ level, ...event });
  byEvent(name) {
    return this.events.filter((e) => e.event === name);
  }
}

// Minimal synthetic worker — behaviour driven by constructor pages/docs arrays.
function makeTestWorker({
  pagesPlan,
  parseOverride,
  persistence,
  embeddings,
  logger,
  now,
  authEnvVar,
  sourceId = 'test-source',
} = {}) {
  class TestWorker extends BaseWorker {
    constructor(opts) {
      super(opts);
      this.source_id = sourceId;
      this.tier = 'A';
      this.authEnvVar = authEnvVar || null;
      this.requestsPerSecond = 100;
    }
    // eslint-disable-next-line no-unused-vars
    async *pages(_opts) {
      for (const page of pagesPlan) yield page;
    }
    parseDocument(raw) {
      if (parseOverride) return parseOverride(raw);
      if (raw.skipMe) {
        throw new DocumentValidationError('deliberately skipped', {
          nativeId: raw.nativeId,
          field: 'skipMe',
        });
      }
      return {
        native_id: raw.nativeId,
        doc_type: 'test',
        title: raw.title,
        embedText: `${raw.title}|${raw.nativeId}`,
      };
    }
  }
  return new TestWorker({
    persistence,
    embeddings,
    logger,
    sleep: () => Promise.resolve(),
    now,
  });
}

function setup(overrides = {}) {
  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const logger = new CapturingLogger();
  const worker = makeTestWorker({ ...overrides, persistence, embeddings, logger: logger.fn });
  return { worker, persistence, embeddings, logger };
}

// ---------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------

test('run() ingests docs end-to-end and finishes with status=success', async () => {
  const pagesPlan = [
    {
      docs: [
        { nativeId: 'a', title: 'Alpha' },
        { nativeId: 'b', title: 'Beta' },
      ],
      nextCursor: { pageNum: 1 },
    },
  ];
  const { worker, persistence, logger } = setup({ pagesPlan });

  const result = await worker.run({ mode: 'delta' });

  assert.equal(result.status, 'success');
  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);

  const runs = persistence.getRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'success');
  assert.equal(runs[0].docs_ingested, 2);
  assert.equal(runs[0].metadata.cursor.pageNum, 1);
  assert.equal(persistence.getDocuments().length, 2);

  assert.ok(logger.byEvent('worker_run_started').length === 1);
  assert.ok(logger.byEvent('worker_run_finished').length === 1);
});

test('run() honours --limit and stops early across pages', async () => {
  const pagesPlan = [
    {
      docs: Array.from({ length: 4 }, (_, i) => ({ nativeId: `a${i}`, title: `Alpha ${i}` })),
      nextCursor: { pageNum: 1 },
    },
    {
      docs: Array.from({ length: 4 }, (_, i) => ({ nativeId: `b${i}`, title: `Beta ${i}` })),
      nextCursor: { pageNum: 2 },
    },
  ];
  const { worker, persistence } = setup({ pagesPlan });
  const result = await worker.run({ mode: 'backfill', limit: 5 });

  assert.equal(result.ingested, 5);
  assert.equal(persistence.getDocuments().length, 5);
});

test('run() --dry-run skips embed, upsert, and log-write', async () => {
  const pagesPlan = [
    {
      docs: [
        { nativeId: 'a', title: 'A' },
        { nativeId: 'b', title: 'B' },
      ],
      nextCursor: null,
    },
  ];
  const { worker, persistence, embeddings } = setup({ pagesPlan });
  const result = await worker.run({ mode: 'delta', dryRun: true });

  assert.equal(result.ingested, 2);
  assert.equal(embeddings.calls.length, 0, 'embeddings must not be called');
  assert.equal(persistence.getDocuments().length, 0, 'docs must not be upserted');
  assert.equal(persistence.getRuns().length, 0, 'no run row must be written');
});

// ---------------------------------------------------------------------
// Error matrix
// ---------------------------------------------------------------------

test('DocumentValidationError skips the doc and increments docs_skipped', async () => {
  const pagesPlan = [
    {
      docs: [
        { nativeId: 'a', title: 'Keep' },
        { nativeId: 'b', skipMe: true },
        { nativeId: 'c', title: 'Keep2' },
      ],
      nextCursor: null,
    },
  ];
  const { worker, persistence, logger } = setup({ pagesPlan });
  const result = await worker.run({ mode: 'delta' });

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 1);
  assert.equal(persistence.getRuns()[0].docs_skipped, 1);
  assert.equal(logger.byEvent('doc_skipped').length, 1);
});

test('skip-rate guardrail only fires on >= 50 docs', async () => {
  // 10 docs, 5 skipped = 50% → should NOT halt (below min-batch floor)
  const pagesPlan = [
    {
      docs: Array.from({ length: 10 }, (_, i) => ({
        nativeId: `d${i}`,
        skipMe: i % 2 === 0,
        title: 'T',
      })),
      nextCursor: null,
    },
  ];
  const { worker, persistence } = setup({ pagesPlan });
  const result = await worker.run({ mode: 'delta' });

  assert.equal(result.ingested, 5);
  assert.equal(result.skipped, 5);
  assert.equal(persistence.getRuns()[0].status, 'success');
});

test('skip-rate guardrail escalates to SourceSchemaError when >= 50 AND >25% skipped', async () => {
  // 60 docs, 20 skipped = 33% → should halt
  const pagesPlan = [
    {
      docs: Array.from({ length: 60 }, (_, i) => ({
        nativeId: `d${i}`,
        skipMe: i < 20,
        title: 'T',
      })),
      nextCursor: null,
    },
  ];
  const { worker, persistence } = setup({ pagesPlan });
  await assert.rejects(() => worker.run({ mode: 'delta' }), SourceSchemaError);
  assert.equal(persistence.getRuns()[0].status, 'failed');
});

test('SourceApiAuthError halts and emits structured auth_failure event', async () => {
  const pagesPlan = (() => {
    // Hack: use an async generator that throws the expected error on first yield
    async function* throwing() {
      throw new SourceApiAuthError('test-source', 'TEST_SOURCE_API_KEY', 'token missing');
      // eslint-disable-next-line no-unreachable
      yield null;
    }
    return throwing();
  })();
  const persistence = new MemoryWorkerPersistence();
  const logger = new CapturingLogger();

  class AuthThrowingWorker extends BaseWorker {
    constructor(opts) {
      super(opts);
      this.source_id = 'test-source';
      this.authEnvVar = 'TEST_SOURCE_API_KEY';
      this.requestsPerSecond = 100;
    }
    async *pages() {
      yield* pagesPlan;
    }
    parseDocument() {
      return null;
    }
  }
  const worker = new AuthThrowingWorker({
    persistence,
    embeddings: new FakeEmbeddings(),
    logger: logger.fn,
    sleep: () => Promise.resolve(),
  });

  await assert.rejects(
    () => worker.run({ mode: 'delta' }),
    (err) => {
      assert.ok(err instanceof SourceApiAuthError);
      assert.match(err.message, /check your TEST_SOURCE_API_KEY/);
      return true;
    },
  );
  const authEvents = logger.byEvent('auth_failure');
  assert.equal(authEvents.length, 1);
  assert.equal(authEvents[0].source, 'test-source');
  assert.equal(persistence.getRuns()[0].status, 'failed');
});

test('EmbeddingError halts and marks the run failed', async () => {
  const pagesPlan = [{ docs: [{ nativeId: 'a', title: 'A' }], nextCursor: null }];
  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings({ throwOnBatch: new Error('upstream dead') });
  const logger = new CapturingLogger();
  const worker = makeTestWorker({ pagesPlan, persistence, embeddings, logger: logger.fn });

  await assert.rejects(() => worker.run({ mode: 'delta' }), EmbeddingError);
  assert.equal(persistence.getRuns()[0].status, 'failed');
});

// ---------------------------------------------------------------------
// Advisory lock
// ---------------------------------------------------------------------

test('second concurrent run aborts with WorkerLockError', async () => {
  const pagesPlan = [{ docs: [{ nativeId: 'a', title: 'A' }], nextCursor: null }];
  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  const workerA = makeTestWorker({ pagesPlan, persistence, embeddings, logger: () => {} });
  const workerB = makeTestWorker({ pagesPlan, persistence, embeddings, logger: () => {} });

  // Acquire lock manually to simulate an in-flight run
  await persistence.tryAdvisoryLock('test-source');
  await assert.rejects(() => workerB.run({ mode: 'delta' }), WorkerLockError);
  await persistence.releaseLock('test-source');

  // Now it can run
  const result = await workerA.run({ mode: 'delta' });
  assert.equal(result.status, 'success');
});

// ---------------------------------------------------------------------
// Cursor resume + staleness
// ---------------------------------------------------------------------

test('--resume loads cursor from last completed run and feeds it to pages()', async () => {
  const persistence = new MemoryWorkerPersistence();
  // Pre-seed a finished run with a cursor
  const runId = await persistence.startRun('test-source', 'delta', null);
  await persistence.finishRun(runId, {
    status: 'success',
    error: null,
    docs_ingested: 50,
    docs_skipped: 0,
  });
  const run = persistence.getRuns()[0];
  run.metadata = { cursor: { pageNum: 9 } };

  const seenCursor = [];
  class CursorAwareWorker extends BaseWorker {
    constructor(opts) {
      super(opts);
      this.source_id = 'test-source';
      this.requestsPerSecond = 100;
    }
    async *pages({ cursor }) {
      seenCursor.push(cursor);
      yield { docs: [{ nativeId: 'x', title: 'X' }], nextCursor: { pageNum: 10 } };
    }
    parseDocument(raw) {
      return { native_id: raw.nativeId, doc_type: 'test', title: raw.title, embedText: raw.title };
    }
  }
  const worker = new CursorAwareWorker({
    persistence,
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    sleep: () => Promise.resolve(),
    now: () => new Date(), // recent finished_at, so not stale
  });
  await worker.run({ mode: 'delta', resume: true });
  assert.equal(seenCursor[0].pageNum, 9);
});

test('stale cursor refuses --resume without --force', async () => {
  const persistence = new MemoryWorkerPersistence();
  const runId = await persistence.startRun('test-source', 'delta', null);
  await persistence.finishRun(runId, {
    status: 'success',
    error: null,
    docs_ingested: 50,
    docs_skipped: 0,
  });
  const run = persistence.getRuns()[0];
  // Backdate to 2 days ago
  run.finished_at = new Date(Date.now() - 48 * 3600 * 1000);
  run.metadata = { cursor: { pageNum: 9 } };

  const worker = makeTestWorker({
    pagesPlan: [],
    persistence,
    embeddings: new FakeEmbeddings(),
    logger: () => {},
    now: () => new Date(),
  });
  await assert.rejects(
    () => worker.run({ mode: 'delta', resume: true }),
    (err) => err instanceof CursorStaleError && /--force/.test(err.message),
  );
});

test('stale cursor accepted with --resume --force, emits warning event', async () => {
  const persistence = new MemoryWorkerPersistence();
  const runId = await persistence.startRun('test-source', 'delta', null);
  await persistence.finishRun(runId, {
    status: 'success',
    error: null,
    docs_ingested: 0,
    docs_skipped: 0,
  });
  persistence.getRuns()[0].finished_at = new Date(Date.now() - 72 * 3600 * 1000);
  persistence.getRuns()[0].metadata = { cursor: { pageNum: 3 } };

  const logger = new CapturingLogger();
  const worker = makeTestWorker({
    pagesPlan: [{ docs: [{ nativeId: 'a', title: 'A' }], nextCursor: { pageNum: 4 } }],
    persistence,
    embeddings: new FakeEmbeddings(),
    logger: logger.fn,
    now: () => new Date(),
  });
  const result = await worker.run({ mode: 'delta', resume: true, force: true });

  assert.equal(result.status, 'success');
  assert.equal(logger.byEvent('resume_cursor_stale_accepted').length, 1);
});

// ---------------------------------------------------------------------
// classifyHttpError (pure function)
// ---------------------------------------------------------------------

test('classifyHttpError maps status codes to the right subclass', () => {
  assert.ok(classifyHttpError(429, 'rate limit', 'src') instanceof SourceApiTransientError);
  assert.ok(classifyHttpError(503, 'down', 'src') instanceof SourceApiTransientError);
  assert.ok(classifyHttpError(400, 'bad', 'src') instanceof SourceApiPermanentError);
  assert.ok(classifyHttpError(404, 'nope', 'src') instanceof SourceApiPermanentError);
  assert.ok(classifyHttpError(401, 'deny', 'src') instanceof SourceApiAuthError);
  assert.ok(classifyHttpError(403, 'deny', 'src') instanceof SourceApiAuthError);
});

test('classifyHttpError builds a helpful auth error message', () => {
  const err = classifyHttpError(401, 'invalid token', 'github-search', {
    authEnvVar: 'GITHUB_TOKEN',
  });
  assert.ok(err instanceof SourceApiAuthError);
  assert.equal(err.envVar, 'GITHUB_TOKEN');
  assert.match(err.message, /check your GITHUB_TOKEN/);
});

// ---------------------------------------------------------------------
// Retry-After handling on 429
// ---------------------------------------------------------------------

const { parseRetryAfter } = require('../worker_errors.js');

test('parseRetryAfter parses integer seconds', () => {
  assert.equal(parseRetryAfter('30'), 30_000);
  assert.equal(parseRetryAfter('0'), 0);
});

test('parseRetryAfter caps absurdly long waits at 10 minutes', () => {
  assert.equal(parseRetryAfter('999999'), 10 * 60 * 1000);
});

test('parseRetryAfter returns null for garbage', () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('not-a-number'), null);
});

test('parseRetryAfter parses HTTP-date', () => {
  const future = new Date(Date.now() + 5_000).toUTCString();
  const ms = parseRetryAfter(future);
  assert.ok(ms >= 4_000 && ms <= 6_000, `expected ~5000ms, got ${ms}`);
});

test('classifyHttpError on 429 extracts retryAfterMs from a plain-object headers map', () => {
  const err = classifyHttpError(429, 'slow down', 'arxiv', {
    headers: { 'Retry-After': '42' },
  });
  assert.ok(err instanceof SourceApiTransientError);
  assert.equal(err.retryAfterMs, 42_000);
});

test('classifyHttpError on 429 extracts retryAfterMs from a Headers-like get()', () => {
  const headers = {
    get(name) {
      return name.toLowerCase() === 'retry-after' ? '7' : null;
    },
  };
  const err = classifyHttpError(429, 'throttled', 'arxiv', { headers });
  assert.equal(err.retryAfterMs, 7_000);
});

test('classifyHttpError on 429 leaves retryAfterMs unset if header is missing', () => {
  const err = classifyHttpError(429, '', 'arxiv', { headers: { get: () => null } });
  assert.ok(err instanceof SourceApiTransientError);
  assert.equal(err.retryAfterMs, undefined);
});

// ---------------------------------------------------------------------
// 429 backoff — retry-after wins; 429 without header uses 30s base
// ---------------------------------------------------------------------

function makeBackoffWorker(overrides = {}) {
  const persistence = new MemoryWorkerPersistence();
  const embeddings = new FakeEmbeddings();
  class MinimalWorker extends BaseWorker {
    constructor(opts) {
      super(opts);
      this.source_id = 'test-source';
      this.requestsPerSecond = 100;
    }
    async *pages() {}
    parseDocument() {}
  }
  return new MinimalWorker({
    persistence,
    embeddings,
    logger: () => {},
    sleep: () => Promise.resolve(),
    randomJitter: () => 0.5, // deterministic
    baseBackoffMs: 500,
    ...overrides,
  });
}

test('_backoffMs honours retryAfterMs when present', () => {
  const worker = makeBackoffWorker();
  const err = new SourceApiTransientError('throttled', { status: 429 });
  err.retryAfterMs = 8_000;
  assert.equal(worker._backoffMs(1, err), 8_000);
  assert.equal(
    worker._backoffMs(3, err),
    8_000,
    'attempt number is irrelevant when server said so',
  );
});

test('_backoffMs on 429 without retryAfter uses the 30s base, not the normal 500ms', () => {
  const worker = makeBackoffWorker();
  const err = new SourceApiTransientError('throttled', { status: 429 });
  const delay = worker._backoffMs(1, err);
  assert.ok(delay >= 25_000 && delay <= 35_000, `expected ~30s ±jitter, got ${delay}ms`);
});

test('_backoffMs on non-429 still uses the normal base backoff', () => {
  const worker = makeBackoffWorker();
  const err = new SourceApiTransientError('down', { status: 503 });
  const delay = worker._backoffMs(1, err);
  assert.ok(delay >= 400 && delay <= 700, `expected ~500ms, got ${delay}ms`);
});
