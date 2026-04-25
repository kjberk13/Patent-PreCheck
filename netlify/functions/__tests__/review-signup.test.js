'use strict';

// Integration tests for the review-signup Lambda.
//
// Pattern mirrors analyze.test.js — substitute the neon module via
// require.cache before requiring the function under test, so the
// handler runs end-to-end without touching a real Neon database.

const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------
// Neon module substitution + env setup BEFORE the function is loaded.
// ---------------------------------------------------------------------

const neonFake = {
  calls: [],
  reset() {
    this.calls = [];
  },
  fn() {
    return async (text, params) => {
      neonFake.calls.push({ text, params });
      return [];
    };
  },
};

const neonModulePath = require.resolve('@neondatabase/serverless');
require.cache[neonModulePath] = {
  id: neonModulePath,
  filename: neonModulePath,
  loaded: true,
  exports: {
    neon: (url) => neonFake.fn(url),
  },
};

// Required env so buildSqlClient picks something up.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/test';
process.env.BETA_ACCESS_TOKEN = 'TEST-BYPASS-2026';

// Now require the function under test — picks up the stubbed neon.
const { handler } = require('../review-signup.js');

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const VALID_HASH = 'a'.repeat(64); // 64 hex chars

function validBody(overrides = {}) {
  return {
    first_name: 'Sample',
    last_name: 'User',
    business_name: '',
    email: 'name@example.com',
    phone: '(555) 123-4567',
    address_line1: '123 Main St',
    address_line2: '',
    address_city: 'Sample City',
    address_state: 'AZ',
    address_zip: '12345',
    address_country: 'US',
    billing_same_as_address: true,
    input_hash: VALID_HASH,
    input_length: 1234,
    ...overrides,
  };
}

function postJson(body, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

function asJson(response) {
  return JSON.parse(response.body);
}

test.beforeEach(() => {
  neonFake.reset();
});

test('OPTIONS preflight returns 200 with CORS headers', async () => {
  const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
  assert.equal(res.statusCode, 200);
});

test('non-POST methods return 405', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(res.statusCode, 405);
});

test('rejects malformed JSON with 400', async () => {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: '{not json' });
  assert.equal(res.statusCode, 400);
  assert.match(asJson(res).error, /Invalid JSON/);
});

test('rejects missing required fields with 400 and lists which', async () => {
  const partial = { first_name: 'S', last_name: 'U' }; // many missing
  const res = await handler(postJson(partial));
  assert.equal(res.statusCode, 400);
  const body = asJson(res);
  assert.ok(Array.isArray(body.missing_fields));
  assert.ok(body.missing_fields.includes('email'));
  assert.ok(body.missing_fields.includes('input_hash'));
});

test('rejects malformed input_hash (not 64 hex) with 400', async () => {
  const res = await handler(postJson(validBody({ input_hash: 'not-a-hash' })));
  assert.equal(res.statusCode, 400);
  assert.match(asJson(res).error, /input_hash/);
});

test('rejects non-positive input_length with 400', async () => {
  const res = await handler(postJson(validBody({ input_length: 0 })));
  assert.equal(res.statusCode, 400);
  assert.match(asJson(res).error, /input_length/);
});

test('when billing_same_as_address=false, billing fields are required', async () => {
  const res = await handler(postJson(validBody({ billing_same_as_address: false })));
  assert.equal(res.statusCode, 400);
  const body = asJson(res);
  assert.ok(body.missing_fields.includes('billing_line1'));
  assert.ok(body.missing_fields.includes('billing_city'));
});

test('with valid access_token matching env: 200 + redirect_url, access_method=beta_bypass', async () => {
  const body = validBody({ access_token: process.env.BETA_ACCESS_TOKEN });
  const res = await handler(
    postJson(body, { 'x-forwarded-for': '198.51.100.42', 'user-agent': 'jest/test' }),
  );
  assert.equal(res.statusCode, 200);
  const json = asJson(res);
  assert.equal(json.access_method, 'beta_bypass');
  assert.match(json.report_id, /^PPC-\d{4}-\d{2}-\d{2}-[A-Z2-9]{5}$/);
  assert.match(json.redirect_url, /\/analyze\.html\?review=PPC-/);
  // SQL INSERT was issued
  assert.equal(neonFake.calls.length, 1);
  const params = neonFake.calls[0].params;
  // Find the access_method positional arg via the column order in the
  // INSERT — easier: just confirm 'beta_bypass' is one of the params.
  assert.ok(params.includes('beta_bypass'));
  assert.ok(params.includes(process.env.BETA_ACCESS_TOKEN));
});

test('without access_token (or wrong token): 402 payment_required, row still inserted', async () => {
  const body = validBody({ access_token: 'WRONG-TOKEN' });
  const res = await handler(postJson(body));
  assert.equal(res.statusCode, 402);
  const json = asJson(res);
  assert.equal(json.payment_required, true);
  assert.match(json.report_id, /^PPC-/);
  assert.equal(neonFake.calls.length, 1, 'row was inserted to capture the lead');
  // access_method should be stripe_payment, access_token_used null
  const params = neonFake.calls[0].params;
  assert.ok(params.includes('stripe_payment'));
  // Index of access_token_used in the param list — same column order
  // as the INSERT statement. Easier check: ensure 'WRONG-TOKEN' is NOT
  // stored when bypass fails.
  assert.ok(!params.includes('WRONG-TOKEN'));
});

test('billing fields are auto-copied from address when billing_same_as_address=true', async () => {
  const body = validBody({
    access_token: process.env.BETA_ACCESS_TOKEN,
    billing_same_as_address: true,
    // attacker tries to inject billing fields anyway — should be ignored
    billing_line1: 'Should be ignored',
    billing_city: 'Ghost city',
  });
  await handler(postJson(body));
  assert.equal(neonFake.calls.length, 1);
  const params = neonFake.calls[0].params;
  // Attacker-supplied billing values are NOT stored
  assert.ok(!params.includes('Should be ignored'));
  assert.ok(!params.includes('Ghost city'));
  // Address values ARE present in billing positions — count occurrences
  // (each address field should appear twice: once for address_*, once for billing_*)
  const addressLine1Count = params.filter((p) => p === '123 Main St').length;
  const cityCount = params.filter((p) => p === 'Sample City').length;
  const stateCount = params.filter((p) => p === 'AZ').length;
  const zipCount = params.filter((p) => p === '12345').length;
  assert.equal(addressLine1Count, 2, 'address_line1 used in both address and billing');
  assert.equal(cityCount, 2, 'city used in both address and billing');
  assert.equal(stateCount, 2, 'state used in both address and billing');
  assert.equal(zipCount, 2, 'zip used in both address and billing');
});
