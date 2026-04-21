'use strict';

// Tests for the shared createPgPool factory: defaults, logger
// injection, and the 'error' handler that turns idle-client
// disconnects (EADDRNOTAVAIL, ECONNRESET) into a logged warning
// instead of an uncaught exception that kills the process.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPgPool, DEFAULT_POOL_OPTS } = require('../pool.js');

test('createPgPool: throws if connectionString is missing', () => {
  assert.throws(() => createPgPool(undefined), /connectionString is required/);
  assert.throws(() => createPgPool(''), /connectionString is required/);
});

test('createPgPool: default options include keepAlive + idle/connect timeouts', () => {
  // Guardrail against someone quietly flipping the defaults — every
  // failure we've seen from long-running backfills was a dropped idle
  // connection, so losing keepAlive would regress us hard.
  assert.equal(DEFAULT_POOL_OPTS.keepAlive, true);
  assert.equal(typeof DEFAULT_POOL_OPTS.idleTimeoutMillis, 'number');
  assert.ok(DEFAULT_POOL_OPTS.idleTimeoutMillis > 0);
  assert.equal(typeof DEFAULT_POOL_OPTS.connectionTimeoutMillis, 'number');
  assert.ok(DEFAULT_POOL_OPTS.connectionTimeoutMillis > 0);
  assert.ok(DEFAULT_POOL_OPTS.max >= 1);
});

test('createPgPool: returns a Pool and installs an error handler', async () => {
  // Use a bogus connection string — we don't actually open a socket;
  // we only check that the returned pool has listeners registered so
  // an idle-client error won't crash the process.
  const pool = createPgPool('postgresql://u:p@127.0.0.1:1/x', {
    logger: () => {},
  });
  try {
    assert.ok(pool, 'pool returned');
    assert.equal(typeof pool.on, 'function', 'pool is an EventEmitter');
    assert.ok(pool.listenerCount('error') >= 1, 'error listener installed');
  } finally {
    // End the pool so the test process exits cleanly. No real
    // connection was ever opened so this resolves immediately.
    await pool.end().catch(() => {});
  }
});

test('createPgPool: error handler logs a structured warning and does not rethrow', async () => {
  const logs = [];
  const pool = createPgPool('postgresql://u:p@127.0.0.1:1/x', {
    logger: (level, event) => logs.push({ level, event }),
  });
  try {
    // Simulate the exact failure mode we saw on the laptop backfill:
    // pg.Pool emits 'error' with an errno-bearing Error when an idle
    // client's socket drops. Before the fix this crashed the process.
    const fakeErr = new Error('read EADDRNOTAVAIL');
    fakeErr.code = 'EADDRNOTAVAIL';
    fakeErr.errno = -49;
    fakeErr.syscall = 'read';
    // Must not throw — if it does, this test fails loudly.
    pool.emit('error', fakeErr, /* client = */ null);

    assert.equal(logs.length, 1, 'one log line emitted');
    assert.equal(logs[0].level, 'warn');
    assert.equal(logs[0].event.event, 'pg_pool_idle_client_error');
    assert.match(logs[0].event.error, /EADDRNOTAVAIL/);
    assert.equal(logs[0].event.error_code, 'EADDRNOTAVAIL');
    assert.equal(logs[0].event.error_syscall, 'read');
  } finally {
    await pool.end().catch(() => {});
  }
});

test('createPgPool: poolOpts overrides merge on top of defaults', async () => {
  const pool = createPgPool('postgresql://u:p@127.0.0.1:1/x', {
    logger: () => {},
    poolOpts: { max: 3, idleTimeoutMillis: 5_000 },
  });
  try {
    // The pg.Pool library exposes options on `pool.options`.
    assert.equal(pool.options.max, 3);
    assert.equal(pool.options.idleTimeoutMillis, 5_000);
    // Unspecified defaults still carry through.
    assert.equal(pool.options.keepAlive, true);
  } finally {
    await pool.end().catch(() => {});
  }
});
