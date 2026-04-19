'use strict';

// =====================================================================
// Patent PreCheck migration runner
//
// Applies SQL files in infra/migrations/ to the database pointed to by
// DATABASE_URL, in filename-sorted order. Each migration is wrapped in its
// own transaction. Bookkeeping lives in the migrations_applied table.
//
// Checksum enforcement: every migration's sha256 is recorded on first apply
// and verified on every subsequent run. A mismatch aborts the run with a
// loud error pointing at the offending file. The runner never auto-reapplies
// or silently skips a drift — add a NEW migration instead.
// =====================================================================

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'infra', 'migrations');

const LOCK_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS migrations_applied (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  const filenames = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  return filenames.map((name) => {
    const fullPath = path.join(MIGRATIONS_DIR, name);
    const sql = fs.readFileSync(fullPath, 'utf8');
    return { name, sql, checksum: sha256(sql), fullPath };
  });
}

async function ensureLockTable(client) {
  await client.query(LOCK_TABLE_DDL);
}

async function fetchApplied(client) {
  const { rows } = await client.query(
    'SELECT name, checksum FROM migrations_applied ORDER BY id ASC',
  );
  return new Map(rows.map((row) => [row.name, row.checksum]));
}

async function applyMigration(client, migration) {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query('INSERT INTO migrations_applied (name, checksum) VALUES ($1, $2)', [
      migration.name,
      migration.checksum,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

function checksumMismatchError(migration, recorded) {
  return new Error(
    [
      `Checksum mismatch on already-applied migration: ${migration.name}`,
      `  file:      ${migration.fullPath}`,
      `  recorded:  ${recorded}`,
      `  current:   ${migration.checksum}`,
      '',
      'An applied migration has been edited. Revert the file to its original',
      'contents, or write a NEW migration with the desired change. The runner',
      'will not auto-reapply a drifted migration.',
    ].join('\n'),
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
    process.exit(1);
  }

  const migrations = loadMigrations();
  if (migrations.length === 0) {
    console.log('No migrations found in', MIGRATIONS_DIR);
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await ensureLockTable(client);
    const applied = await fetchApplied(client);

    let appliedCount = 0;
    let skippedCount = 0;

    for (const migration of migrations) {
      const recorded = applied.get(migration.name);

      if (recorded !== undefined) {
        if (recorded !== migration.checksum) {
          throw checksumMismatchError(migration, recorded);
        }
        console.log(`skip   ${migration.name}  (already applied)`);
        skippedCount += 1;
        continue;
      }

      console.log(`apply  ${migration.name}`);
      await applyMigration(client, migration);
      appliedCount += 1;
    }

    console.log(`Done. Applied ${appliedCount} new migration(s), ${skippedCount} already current.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration run failed:');
  console.error(err.message ?? err);
  if (process.env.LOG_LEVEL === 'debug' && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
