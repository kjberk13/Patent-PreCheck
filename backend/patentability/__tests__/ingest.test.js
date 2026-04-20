'use strict';

// Tests for the ingest CLI's DATABASE_URL validation and password-redaction
// helpers. These are the diagnostics layer that surfaces the underlying
// cause when a Railway env misconfiguration pushes a bad hostname into pg.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateDatabaseUrl, redactPassword } = require('../ingest.js');

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
