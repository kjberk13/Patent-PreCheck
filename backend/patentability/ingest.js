#!/usr/bin/env node
'use strict';

// =====================================================================
// Ingestion CLI.
//
//   npm run ingest -- --source=<id> --mode=<backfill|delta> [options]
//   npm run ingest -- --list                      # print the registry
//   npm run ingest -- --all --mode=delta [...]    # run every implemented worker in priority order
//
// Options:
//   --source=<id>        run one worker (registered in ./workers/registry.js)
//   --all                run every implemented worker, priority-ordered
//   --mode=<m>           backfill | delta  (default: delta)
//   --resume             resume from the last run's cursor (requires a prior success/failure)
//   --force              together with --resume, accept a cursor older than 24h
//   --limit=N            stop after N ingested docs (testing; default unlimited)
//   --dry-run            fetch + parse + validate only; no embed/upsert/log-write
//   --list               print registry and exit
//
// Parallelism note:
//   Orchestrator runs workers serially by design for v1. If we later want
//   to dispatch independent sources in parallel, this is the extension
//   point — introduce a shared token bucket keyed by API credential
//   (e.g. GITHUB_TOKEN) and wrap runWorker() in a concurrency pool.
// =====================================================================

require('dotenv').config();

const { Embeddings } = require('../shared/embeddings.js');
const { PostgresWorkerPersistence } = require('../shared/worker_persistence.js');
const { WorkerError, CursorStaleError, WorkerLockError } = require('../shared/worker_errors.js');
const { createPgPool } = require('../shared/pool.js');
const {
  getEntry,
  listImplemented,
  listAll,
  STATUS_IMPLEMENTED,
} = require('./workers/registry.js');

// Env-var overrides for Railway ad-hoc backfills.
//
// The ingest-delta Railway service runs `npm run ingest:delta`, whose
// CLI args are hard-coded to `--all --mode=delta`. To convert a single
// run into a backfill without editing the Procfile or redeploying, the
// operator sets env vars on the service and redeploys:
//
//   INGEST_MODE=backfill     overrides --mode
//   INGEST_LIMIT=15000       overrides --limit
//   INGEST_SOURCE=uspto-...  overrides --all / --source (runs one source)
//   INGEST_RESUME=1          sets --resume
//   INGEST_FORCE=1           sets --force
//   INGEST_DRY_RUN=1         sets --dry-run
//
// When unset, behavior matches the bare CLI. Env overrides CLI (not the
// usual precedence) precisely because the CLI args come from the
// Procfile and can't be changed on-the-fly from the Railway dashboard.
// Clear the env var when the one-off job is done so subsequent cron
// runs return to delta mode.
function envOverrides(env = process.env) {
  const out = {};
  if (env.INGEST_MODE) out.mode = env.INGEST_MODE;
  if (env.INGEST_LIMIT) out.limit = Number.parseInt(env.INGEST_LIMIT, 10);
  if (env.INGEST_SOURCE) out.source = env.INGEST_SOURCE;
  if (isTruthyEnv(env.INGEST_RESUME)) out.resume = true;
  if (isTruthyEnv(env.INGEST_FORCE)) out.force = true;
  if (isTruthyEnv(env.INGEST_DRY_RUN)) out.dryRun = true;
  return out;
}

function isTruthyEnv(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function parseArgs(argv, env = process.env) {
  const opts = {
    source: null,
    all: false,
    mode: 'delta',
    resume: false,
    force: false,
    limit: null,
    dryRun: false,
    list: false,
  };
  for (const raw of argv) {
    if (raw === '--list') opts.list = true;
    else if (raw === '--all') opts.all = true;
    else if (raw === '--resume') opts.resume = true;
    else if (raw === '--force') opts.force = true;
    else if (raw === '--dry-run') opts.dryRun = true;
    else if (raw.startsWith('--source=')) opts.source = raw.slice('--source='.length);
    else if (raw.startsWith('--mode=')) opts.mode = raw.slice('--mode='.length);
    else if (raw.startsWith('--limit=')) opts.limit = Number.parseInt(raw.slice('--limit='.length), 10);
    else if (raw === '-h' || raw === '--help') opts.list = true;
    else throw new Error(`unknown argument: ${raw}`);
  }
  // Env vars layer over CLI. If INGEST_SOURCE is set, it narrows the
  // run to one source even if --all was on the CLI (clears .all so
  // downstream logic treats it as a single-source run).
  const overrides = envOverrides(env);
  if (overrides.mode !== undefined) opts.mode = overrides.mode;
  if (overrides.limit !== undefined) opts.limit = overrides.limit;
  if (overrides.source !== undefined) {
    opts.source = overrides.source;
    opts.all = false;
  }
  if (overrides.resume !== undefined) opts.resume = overrides.resume;
  if (overrides.force !== undefined) opts.force = overrides.force;
  if (overrides.dryRun !== undefined) opts.dryRun = overrides.dryRun;

  if (opts.limit != null && (!Number.isFinite(opts.limit) || opts.limit < 1)) {
    throw new Error(`--limit must be a positive integer, got: ${opts.limit}`);
  }
  if (opts.mode !== 'backfill' && opts.mode !== 'delta') {
    throw new Error(`--mode must be 'backfill' or 'delta', got: ${opts.mode}`);
  }
  if (!opts.list && !opts.source && !opts.all) {
    throw new Error(
      'one of --source=<id>, --all, --list, or INGEST_SOURCE env var is required',
    );
  }
  if (opts.force && !opts.resume) {
    throw new Error('--force only makes sense with --resume');
  }
  return opts;
}

function printRegistry() {
  const rows = listAll();
  const maxId = Math.max(...rows.map((r) => r.id.length));
  console.log('Ingestion worker registry:');
  console.log(`  ${'source'.padEnd(maxId)}  tier  priority  status`);
  console.log(`  ${'─'.repeat(maxId)}  ────  ────────  ───────────`);
  for (const r of rows) {
    const status =
      r.status === STATUS_IMPLEMENTED ? '\x1b[32mimplemented\x1b[0m' : '\x1b[90mplanned\x1b[0m';
    console.log(
      `  ${r.id.padEnd(maxId)}  ${r.tier.padEnd(4)}  ${r.priority.padEnd(8)}  ${status}`,
    );
  }
  const impl = listImplemented().length;
  console.log(`\n${impl} implemented, ${rows.length - impl} planned.`);
}

async function buildRunnerContext() {
  const validated = validateDatabaseUrl(process.env.DATABASE_URL);
  logStartup(validated);
  const pool = createPgPool(process.env.DATABASE_URL, { logger: log });
  await preflightDatabaseConnection(pool);
  const persistence = new PostgresWorkerPersistence(pool);
  const embeddings = new Embeddings({ pgPool: pool });
  return { pool, persistence, embeddings };
}

// ---------------------------------------------------------------------
// DATABASE_URL validation + startup diagnostics.
// ---------------------------------------------------------------------

const SUSPICIOUS_HOSTS_WITHOUT_PORT = new Set([
  'base',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'undefined',
  'null',
  '',
]);

function validateDatabaseUrl(url) {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Set it in Railway environment variables to the Neon direct endpoint ' +
        '(postgresql://user:pass@ep-...neon.tech/db?sslmode=require).',
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error(
      `DATABASE_URL is not a parseable URL (${err.message}). Value (password redacted): ${redactPassword(url)}. ` +
        'Check the Railway environment variable for typos or truncation.',
    );
  }
  if (!parsed.hostname) {
    throw new Error(
      `DATABASE_URL has no hostname. Value (password redacted): ${redactPassword(url)}. ` +
        'Expected postgresql://user:pass@HOST/db.',
    );
  }
  if (SUSPICIOUS_HOSTS_WITHOUT_PORT.has(parsed.hostname.toLowerCase()) && parsed.port === '') {
    throw new Error(
      `DATABASE_URL hostname "${parsed.hostname}" looks invalid. ` +
        'This often happens when a Railway variable reference failed to substitute ' +
        '(e.g. ${{Postgres.DATABASE_URL}} pointing at a non-existent service). ' +
        `Full value (password redacted): ${redactPassword(url)}. ` +
        'Expected a full Postgres URL with a real hostname like "ep-....neon.tech".',
    );
  }
  return {
    hostname: parsed.hostname,
    port: parsed.port || '(default)',
    database: parsed.pathname.replace(/^\//, '') || '(none)',
    username: parsed.username || '(none)',
    sslmode: parsed.searchParams.get('sslmode') || '(unset)',
  };
}

function redactPassword(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    // URL unparseable; crude fallback.
    return url.replace(/:\/\/([^:/@]+):[^@]+@/, '://$1:***@');
  }
}

function logStartup(validated) {
  // Log a redacted summary of what pg will see, plus any PG* env vars that
  // could override the connection string (pg's Client falls back to these
  // when a parsed field is missing). Helps pin down env-vs-URL conflicts.
  const pgEnv = {};
  for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGSSLMODE']) {
    if (process.env[key] !== undefined) pgEnv[key] = process.env[key];
  }

  // Presence check (NOT value) for every env var a worker might read.
  // If a value is set on Railway's Shared Variables but the service
  // isn't linked to that variable, process.env won't see it — and this
  // log line tells us that before any worker throws its own auth error.
  const authEnvPresence = {};
  for (const key of [
    'ANTHROPIC_API_KEY',
    'VOYAGE_API_KEY',
    'OPENAI_API_KEY',
    'USPTO_API_KEY',
    'GITHUB_TOKEN',
    'SEMANTIC_SCHOLAR_API_KEY',
    'IEEE_API_KEY',
  ]) {
    authEnvPresence[key] = Boolean(process.env[key] && process.env[key].length > 0);
  }

  log('info', {
    event: 'ingest_startup',
    database_url_hostname: validated.hostname,
    database_url_port: validated.port,
    database_url_database: validated.database,
    database_url_username: validated.username,
    database_url_sslmode: validated.sslmode,
    pg_env_overrides: Object.keys(pgEnv).length > 0 ? pgEnv : '(none)',
    auth_env_presence: authEnvPresence,
    node_version: process.version,
  });
}

async function preflightDatabaseConnection(pool) {
  let rows;
  try {
    const result = await pool.query('SELECT 1 AS ok');
    rows = result.rows;
  } catch (err) {
    const underlying = err && err.message ? err.message : String(err);
    const code = err && err.code ? err.code : null;
    const hostname = redactedUrlHostname();
    throw new Error(
      `DATABASE_URL preflight failed — could not run SELECT 1 against the connection. ` +
        `Parsed hostname: "${hostname}". Underlying error: ${underlying}` +
        (code ? ` (code=${code})` : '') +
        '. Check the Railway DATABASE_URL env var: hostname, credentials, and sslmode=require.',
    );
  }
  if (!rows || rows[0]?.ok !== 1) {
    throw new Error('DATABASE_URL preflight returned an unexpected response; aborting.');
  }
  log('info', { event: 'db_preflight_ok' });
}

function redactedUrlHostname() {
  try {
    return new URL(process.env.DATABASE_URL || '').hostname || '(unset)';
  } catch {
    return '(unparseable)';
  }
}

function log(level, event) {
  const fn = level === 'error' ? console.error : console.log;
  fn(JSON.stringify({ level, ts: new Date().toISOString(), ...event }));
}

async function runWorker(entry, { persistence, embeddings }, opts) {
  if (!entry || entry.status !== STATUS_IMPLEMENTED || !entry.worker) {
    throw new Error(`source '${entry ? entry.id : 'unknown'}' is not implemented yet`);
  }
  const WorkerClass = entry.worker;
  const worker = new WorkerClass({ persistence, embeddings });
  const result = await worker.run({
    mode: opts.mode,
    limit: opts.limit,
    dryRun: opts.dryRun,
    resume: opts.resume,
    force: opts.force,
  });
  return result;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    console.error('Usage: npm run ingest -- --source=<id> --mode=<backfill|delta> [options]');
    console.error('       npm run ingest -- --all --mode=delta');
    console.error('       npm run ingest -- --list');
    process.exit(2);
  }

  if (opts.list) {
    printRegistry();
    return;
  }

  const { pool, persistence, embeddings } = await buildRunnerContext();
  const targets = [];

  if (opts.source) {
    const entry = getEntry(opts.source);
    if (!entry) {
      console.error(`Error: unknown source '${opts.source}'. Run with --list to see options.`);
      await pool.end();
      process.exit(2);
    }
    targets.push(entry);
  } else if (opts.all) {
    targets.push(...listImplemented());
  }

  const outcomes = [];
  try {
    for (const entry of targets) {
      console.log(`\n▶ Running ${entry.id} (tier ${entry.tier}, mode=${opts.mode})`);
      try {
        const result = await runWorker(entry, { persistence, embeddings }, opts);
        outcomes.push({ id: entry.id, result });
        console.log(
          `✓ ${entry.id}: ingested=${result.ingested} skipped=${result.skipped}`,
        );
      } catch (err) {
        outcomes.push({ id: entry.id, error: err });
        if (err instanceof CursorStaleError) {
          console.error(`✗ ${entry.id}: ${err.message}`);
        } else if (err instanceof WorkerLockError) {
          console.error(`✗ ${entry.id}: ${err.message}`);
        } else if (err instanceof WorkerError) {
          console.error(`✗ ${entry.id}: [${err.name}] ${err.message}`);
        } else {
          console.error(`✗ ${entry.id}: [${err.name || 'Error'}] ${err.message}`);
        }
        // Per the error taxonomy: the halted source is halted, but we
        // keep going across other sources in --all mode.
        if (!opts.all) throw err;
      }
    }
  } finally {
    await pool.end();
  }

  const failed = outcomes.filter((o) => o.error);
  if (failed.length > 0) {
    console.error(`\n${failed.length} of ${outcomes.length} worker(s) failed.`);
    process.exit(1);
  }
  console.log(`\nDone. ${outcomes.length} worker(s) succeeded.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { parseArgs, runWorker, validateDatabaseUrl, redactPassword };
