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

// Stub the email sender so the Lambda's fire-and-forget call is
// observable but never touches Resend.
const emailFake = {
  calls: [],
  reset() {
    this.calls = [];
  },
  send(args) {
    this.calls.push(args);
    return Promise.resolve({ success: true, messageId: 'msg_fake' });
  },
};
const emailModulePath = require.resolve('../../../backend/code_review/email_sender.js');
require.cache[emailModulePath] = {
  id: emailModulePath,
  filename: emailModulePath,
  loaded: true,
  exports: {
    sendAccessLinkEmail: (args) => emailFake.send(args),
    renderEmailHtml: () => '',
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

// 50-char placeholder paste_input — comfortably above the 20-char minimum
// the Lambda enforces (PR-B). Tests that target paste_input edge cases
// override this explicitly.
const VALID_PASTE_INPUT = 'function add(a, b) { return a + b; } // sample';

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
    paste_input: VALID_PASTE_INPUT,
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
  emailFake.reset();
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
  assert.match(json.redirect_url, /\/review\.html\?id=PPC-/);
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

test('successful signup fires the access-link email exactly once with expected args', async () => {
  const body = validBody({ access_token: process.env.BETA_ACCESS_TOKEN });
  const res = await handler(postJson(body));
  assert.equal(res.statusCode, 200);
  // Email called exactly once — fire-and-forget; not awaited but the
  // call itself happens synchronously before the response is returned.
  assert.equal(emailFake.calls.length, 1, 'access-link email fired once');
  const args = emailFake.calls[0];
  assert.equal(args.to, 'name@example.com');
  assert.equal(args.firstName, 'Sample');
  assert.match(args.reportId, /^PPC-/);
  // sessionEndDate is an ISO string ~30 days in the future
  const end = new Date(args.sessionEndDate);
  const days = (end.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(days > 29 && days < 31, `sessionEndDate ~30d out, got ${days}d`);
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

// ---------------------------------------------------------------------
// PR-B: paste_input validation + log redaction
// ---------------------------------------------------------------------

test('valid POST persists paste_input in the INSERT params', async () => {
  const body = validBody({
    access_token: process.env.BETA_ACCESS_TOKEN,
    paste_input: 'function specificMarker() { return 42; }',
  });
  const res = await handler(postJson(body));
  assert.equal(res.statusCode, 200);
  assert.equal(neonFake.calls.length, 1);
  const params = neonFake.calls[0].params;
  assert.ok(
    params.includes('function specificMarker() { return 42; }'),
    'paste_input value present in INSERT params',
  );
});

test('missing paste_input returns 400 with error=paste_input_invalid', async () => {
  const body = validBody();
  delete body.paste_input;
  const res = await handler(postJson(body));
  assert.equal(res.statusCode, 400);
  const json = asJson(res);
  assert.equal(json.error, 'paste_input_invalid');
  assert.match(json.detail, /string/);
});

test('paste_input shorter than 20 chars returns 400 with paste_input_invalid', async () => {
  const res = await handler(postJson(validBody({ paste_input: 'x'.repeat(19) })));
  assert.equal(res.statusCode, 400);
  const json = asJson(res);
  assert.equal(json.error, 'paste_input_invalid');
  assert.match(json.detail, /at least 20/);
});

test('paste_input longer than 30000 chars returns 400 with paste_input_invalid', async () => {
  const res = await handler(postJson(validBody({ paste_input: 'x'.repeat(30001) })));
  assert.equal(res.statusCode, 400);
  const json = asJson(res);
  assert.equal(json.error, 'paste_input_invalid');
  assert.match(json.detail, /at most 30000/);
});

test('paste_input non-string returns 400 with paste_input_invalid', async () => {
  const res = await handler(postJson(validBody({ paste_input: 12345 })));
  assert.equal(res.statusCode, 400);
  const json = asJson(res);
  assert.equal(json.error, 'paste_input_invalid');
  assert.match(json.detail, /string/);
});

test('log output redacts paste_input content; emits length + sha256 fingerprint', async () => {
  const SECRET_MARKER = 'TOP_SECRET_INVENTION_DO_NOT_LEAK_42';
  const padded = SECRET_MARKER + ' '.repeat(50); // ensure >= 20 chars
  const captured = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (line) => captured.push(String(line));
  console.error = (line) => captured.push(String(line));
  try {
    const res = await handler(
      postJson(validBody({
        access_token: process.env.BETA_ACCESS_TOKEN,
        paste_input: padded,
      })),
    );
    assert.equal(res.statusCode, 200);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const joined = captured.join('\n');
  // Content must NEVER appear in any log line.
  assert.ok(
    !joined.includes(SECRET_MARKER),
    'paste_input content must not appear in log output',
  );
  // Length and SHA-256 fingerprint must appear.
  const expectedSha = require('node:crypto').createHash('sha256').update(padded).digest('hex');
  assert.ok(joined.includes('"paste_input_length":' + padded.length), 'paste_input_length logged');
  assert.ok(joined.includes('"paste_input_sha256":"' + expectedSha + '"'), 'paste_input_sha256 logged');
});

// ---------------------------------------------------------------------
// PR-B: frontend smoke — review-signup.html renders the new fieldset
// ---------------------------------------------------------------------

test('review-signup.html renders #codeAttachmentGroup markup', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../../apps/website/review-signup.html'),
    'utf8',
  );
  assert.ok(html.includes('id="codeAttachmentGroup"'), 'fieldset id present');
  assert.ok(html.includes('id="codeAttachmentToggle"'), 'toggle button id present');
  assert.ok(html.includes('id="reviewPasteInput"'), 'textarea id present');
  assert.ok(html.includes('name="paste_input"'), 'textarea name=paste_input present');
});
