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

const { Pool } = require('pg');

const { Embeddings } = require('../shared/embeddings.js');
const { PostgresWorkerPersistence } = require('../shared/worker_persistence.js');
const { WorkerError, CursorStaleError, WorkerLockError } = require('../shared/worker_errors.js');
const {
  getEntry,
  listImplemented,
  listAll,
  STATUS_IMPLEMENTED,
} = require('./workers/registry.js');

function parseArgs(argv) {
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
  if (opts.limit != null && (!Number.isFinite(opts.limit) || opts.limit < 1)) {
    throw new Error(`--limit must be a positive integer, got: ${opts.limit}`);
  }
  if (opts.mode !== 'backfill' && opts.mode !== 'delta') {
    throw new Error(`--mode must be 'backfill' or 'delta', got: ${opts.mode}`);
  }
  if (!opts.list && !opts.source && !opts.all) {
    throw new Error('one of --source=<id>, --all, or --list is required');
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
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set; copy .env.example to .env first');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const persistence = new PostgresWorkerPersistence(pool);
  const embeddings = new Embeddings({ pgPool: pool });
  return { pool, persistence, embeddings };
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

module.exports = { parseArgs, runWorker };
