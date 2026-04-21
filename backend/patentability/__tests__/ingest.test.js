'use strict';

// Tests for the ingest CLI's DATABASE_URL validation and password-redaction
// helpers. These are the diagnostics layer that surfaces the underlying
// cause when a Railway env misconfiguration pushes a bad hostname into pg.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateDatabaseUrl, redactPassword, parseArgs } = require('../ingest.js');

const VALID =
  'postgresql://ppc:secret@ep-falling-butterfly-ama13o3n.c-5.us-east-1.aws.neon.tech/patentprecheck?sslmode=require';

// ---------------------------------------------------------------------
// validateDatabaseUrl
// ---------------------------------------------------------------------

test('accepts a well-formed Neon URL', () => {
  const info = validateDatabaseUrl(VALID);
  assert.equal(info.hostname, 'ep-falling-butterfly-ama13o3n.c-5.us-east-1.aws.neon.tech');
  assert.equal(info.database, 'patentprecheck');
  assert.equal(info.username, 'ppc');
  assert.equal(info.sslmode, 'require');
});

test('accepts localhost WITH an explicit port (valid local dev config)', () => {
  const info = validateDatabaseUrl('postgresql://u:p@localhost:5433/ppc');
  assert.equal(info.hostname, 'localhost');
  assert.equal(info.port, '5433');
});

test('rejects a missing / empty DATABASE_URL', () => {
  assert.throws(() => validateDatabaseUrl(undefined), /DATABASE_URL is not set/);
  assert.throws(() => validateDatabaseUrl(''), /DATABASE_URL is not set/);
  assert.throws(() => validateDatabaseUrl('   '), /DATABASE_URL is not set/);
});

test('rejects an unparseable URL and includes it (password redacted) in the error', () => {
  assert.throws(
    () => validateDatabaseUrl('not a url'),
    (err) => /not a parseable URL/.test(err.message),
  );
});

test('rejects a URL with hostname "base" and no port (Kevin\'s actual failure mode)', () => {
  assert.throws(
    () => validateDatabaseUrl('postgresql://u:p@base/ppc'),
    (err) => {
      assert.match(err.message, /hostname "base" looks invalid/);
      assert.match(err.message, /Railway variable reference failed to substitute/);
      // Password must be redacted in the echoed URL.
      assert.ok(!err.message.includes('u:p@'));
      return true;
    },
  );
});

test('rejects localhost WITHOUT a port', () => {
  assert.throws(
    () => validateDatabaseUrl('postgresql://u:p@localhost/ppc'),
    /hostname "localhost" looks invalid/,
  );
});

test('rejects literal "undefined" hostname (unsubstituted template)', () => {
  assert.throws(
    () => validateDatabaseUrl('postgresql://u:p@undefined/ppc'),
    /hostname "undefined" looks invalid/,
  );
});

// ---------------------------------------------------------------------
// redactPassword
// ---------------------------------------------------------------------

test('redactPassword replaces the password segment with ***', () => {
  const out = redactPassword('postgresql://ppc:npg_topsecret@ep-xxx.neon.tech/db?sslmode=require');
  assert.ok(!out.includes('npg_topsecret'));
  assert.ok(out.includes('***'));
  assert.ok(out.includes('ep-xxx.neon.tech'));
  assert.ok(out.includes('ppc'));
});

test('redactPassword handles unparseable input gracefully', () => {
  const out = redactPassword('totally not a url');
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
});

test('redactPassword handles URL without a password', () => {
  const out = redactPassword('postgresql://ppc@host/db');
  assert.equal(typeof out, 'string');
  assert.ok(out.includes('ppc'));
});

// ---------------------------------------------------------------------
// parseArgs + env-var overrides
//
// Semantics: env vars take precedence over CLI args so a Railway
// operator can flip the ingest-delta service into backfill mode
// without editing the Procfile or redeploying a code change.
// ---------------------------------------------------------------------

test('parseArgs: CLI args alone behave as before (delta defaults)', () => {
  const opts = parseArgs(['--all', '--mode=delta'], {});
  assert.equal(opts.mode, 'delta');
  assert.equal(opts.all, true);
  assert.equal(opts.source, null);
  assert.equal(opts.limit, null);
});

test('parseArgs: INGEST_MODE env overrides --mode=delta CLI arg', () => {
  const opts = parseArgs(['--all', '--mode=delta'], { INGEST_MODE: 'backfill' });
  assert.equal(opts.mode, 'backfill');
});

test('parseArgs: INGEST_LIMIT env overrides --limit CLI arg', () => {
  const opts = parseArgs(['--all'], { INGEST_LIMIT: '15000' });
  assert.equal(opts.limit, 15000);
});

test('parseArgs: INGEST_SOURCE env overrides --all and narrows to one source', () => {
  const opts = parseArgs(['--all'], { INGEST_SOURCE: 'uspto-patentsview' });
  assert.equal(opts.source, 'uspto-patentsview');
  assert.equal(opts.all, false, 'INGEST_SOURCE clears --all');
});

test('parseArgs: INGEST_RESUME / INGEST_FORCE / INGEST_DRY_RUN accept truthy strings', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
    const opts = parseArgs(['--all'], { INGEST_RESUME: v, INGEST_FORCE: v, INGEST_DRY_RUN: v });
    assert.equal(opts.resume, true, `resume for ${v}`);
    assert.equal(opts.force, true, `force for ${v}`);
    assert.equal(opts.dryRun, true, `dryRun for ${v}`);
  }
});

test('parseArgs: INGEST_* env vars treat empty / unset / "0" as off', () => {
  const opts = parseArgs(['--all'], { INGEST_RESUME: '', INGEST_FORCE: '0', INGEST_DRY_RUN: undefined });
  assert.equal(opts.resume, false);
  assert.equal(opts.force, false);
  assert.equal(opts.dryRun, false);
});

test('parseArgs: invalid INGEST_MODE surfaces a clear error', () => {
  assert.throws(
    () => parseArgs(['--all'], { INGEST_MODE: 'turbo' }),
    /--mode must be 'backfill' or 'delta'/,
  );
});

test('parseArgs: INGEST_SOURCE alone (no CLI target) is a valid run shape', () => {
  // Simulates the Railway Procfile-free override case.
  const opts = parseArgs([], { INGEST_SOURCE: 'arxiv', INGEST_MODE: 'backfill' });
  assert.equal(opts.source, 'arxiv');
  assert.equal(opts.mode, 'backfill');
  assert.equal(opts.all, false);
});
