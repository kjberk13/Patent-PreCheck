'use strict';

// =====================================================================
// Shared pg.Pool factory with resilient defaults.
//
// Background: a long-running backfill that tunneled through `railway
// run` from a laptop died after ~282 queries with
//   Error: read EADDRNOTAVAIL
//   errno: -49, syscall: 'read'
// triggered on an idle pool client (Client.idleListener). Root cause:
// an idle TCP connection was dropped by the tunnel / by Neon's
// idle-connection timer. When an idle client errors, pg.Pool emits
// a 'error' event on the pool; if nothing handles it, Node's
// EventEmitter throws and the process crashes.
//
// The fix has two pieces:
//   1. Install a pool 'error' handler that LOGS and discards the
//      bad client. pg.Pool will transparently create a fresh one on
//      the next query — no application-level retry needed.
//   2. Set keepAlive + a bounded idleTimeout so idle connections
//      don't drift into the "silently dead" state in the first
//      place.
//
// Every ingest / embeddings / worker path should create its pool via
// this factory, not `new Pool(...)` directly, so the resilience is
// applied uniformly.
// =====================================================================

const { Pool } = require('pg');

const DEFAULT_OPTS = Object.freeze({
  // Close idle clients after this long — short enough that Neon /
  // Railway don't kill them first and leave us holding a dead socket.
  idleTimeoutMillis: 30_000,
  // Fail fast if the server doesn't accept a new connection. Without
  // this, a misconfigured DATABASE_URL or a partitioned network hangs
  // indefinitely instead of surfacing a real error.
  connectionTimeoutMillis: 10_000,
  // Cap concurrency. 10 is plenty for serial workers; embeddings +
  // persistence share the pool.
  max: 10,
  // TCP keepalive probes prevent the "idle connection silently
  // disappears" failure mode that happens with Railway tunnels and
  // some PaaS load balancers. 10 s is conservative; aggressive
  // enough to detect breakage before our first query does.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

function defaultLogger(level, event) {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...event });
  (level === 'error' ? console.error : console.log)(line);
}

// createPgPool(connectionString[, { logger, poolOpts }]) → Pool
//
//   connectionString   the Postgres URL (required)
//   logger(level,evt)  structured logger; defaults to JSON-to-stdout
//   poolOpts           optional pg.Pool overrides merged on top of DEFAULT_OPTS
//
// Returns a pg.Pool with an 'error' handler installed, so a dropped
// idle client logs an event instead of crashing the process.
function createPgPool(connectionString, { logger = defaultLogger, poolOpts = {} } = {}) {
  if (!connectionString) {
    throw new TypeError('createPgPool: connectionString is required');
  }
  const pool = new Pool({
    connectionString,
    ...DEFAULT_OPTS,
    ...poolOpts,
  });
  pool.on('error', (err) => {
    // Idle client error. pg.Pool has already removed the bad client;
    // the next .query() / .connect() call gets a fresh one. We just
    // log so the crash we used to have becomes a visible-but-safe
    // event. `code` (ECONNRESET / EADDRNOTAVAIL / etc.) goes into
    // the event so the operator can spot patterns.
    logger('warn', {
      event: 'pg_pool_idle_client_error',
      error: err && err.message ? err.message : String(err),
      error_code: err && err.code ? err.code : null,
      error_syscall: err && err.syscall ? err.syscall : null,
    });
  });
  return pool;
}

module.exports = {
  createPgPool,
  DEFAULT_POOL_OPTS: DEFAULT_OPTS,
};
