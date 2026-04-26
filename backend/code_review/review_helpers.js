'use strict';

// =====================================================================
// Code Review — shared helpers
//
// Small, dependency-free utilities used by both the signup Lambda and
// the session-engine Lambda. All functions are pure (no DB, no HTTP)
// so they're trivially testable.
// =====================================================================

const crypto = require('node:crypto');

// Report ID format: PPC-YYYY-MM-DD-XXXXX where XXXXX is a 5-char
// alphanumeric string from a no-confusables alphabet (no I, O, 0, 1).
// Locked in ENGINE_STATE.md; matches the free-tier report ID style so
// the paid tier just appends suffixes (e.g. -IDF, -APP) for the dual
// deliverables Commit 4 will emit.
const REPORT_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REPORT_ID_RAND_LEN = 5;

function generateReportId(now = new Date(), randomFn = randomChar) {
  const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  let suffix = '';
  for (let i = 0; i < REPORT_ID_RAND_LEN; i += 1) suffix += randomFn();
  return `PPC-${yyyy}-${mm}-${dd}-${suffix}`;
}

function randomChar() {
  // Math.random is fine for report IDs — they're identifiers, not
  // secrets. Tests can inject a deterministic randomFn.
  const idx = Math.floor(Math.random() * REPORT_ID_ALPHABET.length);
  return REPORT_ID_ALPHABET.charAt(idx);
}

// ---------------------------------------------------------------------
// HTTP response shape used by both Lambdas.
// ---------------------------------------------------------------------

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

// CORS for fetch from the deployed origin. Same shape analyze.js uses;
// review endpoints are same-origin in v1 but headers are cheap.
const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------
// Beta access check.
//
// We compare the supplied token to BETA_ACCESS_TOKEN with a constant-
// time comparison. That's belt-and-suspenders — the token isn't a
// per-user secret (it's a single shared bypass code distributed to
// beta testers) — but timing-safe equality is essentially free and
// keeps the door closed if the bypass code ever rotates to something
// rate-limit-sensitive.
// ---------------------------------------------------------------------

function checkBypassToken(suppliedToken) {
  const expected = process.env.BETA_ACCESS_TOKEN;
  if (!expected) return false; // env not set → no bypass available
  if (typeof suppliedToken !== 'string' || suppliedToken.length === 0) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(suppliedToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------
// Lightweight body validation.
// ---------------------------------------------------------------------

function parseJsonBody(rawBody) {
  if (rawBody == null || rawBody === '') return {};
  try {
    return JSON.parse(rawBody);
  } catch {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

function requireFields(body, fields) {
  const missing = [];
  for (const name of fields) {
    const val = body[name];
    if (val == null || (typeof val === 'string' && val.trim().length === 0)) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    const err = new Error(`Missing required fields: ${missing.join(', ')}`);
    err.statusCode = 400;
    err.missing = missing;
    throw err;
  }
}

// ---------------------------------------------------------------------
// Neon factory — kept pluggable so tests can swap the SQL function for
// an in-memory fake without round-tripping through @neondatabase.
// ---------------------------------------------------------------------

function buildSqlClient() {
  const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!url) {
    return null;
  }
  // Lazy require keeps cold-start minimal when running tests that
  // don't touch the DB (analyze.test.js already overrides this module
  // in require.cache before importing the Lambda).
  const { neon } = require('@neondatabase/serverless');
  return neon(url);
}

// ---------------------------------------------------------------------
// Structured logger (matches analyze.js JSON-per-line convention).
// ---------------------------------------------------------------------

function log(level, event) {
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify({ level, ts: new Date().toISOString(), ...event }));
}

module.exports = {
  generateReportId,
  REPORT_ID_ALPHABET,
  respond,
  JSON_HEADERS,
  CORS_HEADERS,
  checkBypassToken,
  parseJsonBody,
  requireFields,
  buildSqlClient,
  log,
};
