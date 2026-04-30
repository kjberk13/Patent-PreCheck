'use strict';

// Unit tests for the access-link email sender.
//
// Pattern mirrors review-signup.test.js: stub the third-party SDK via
// require.cache before requiring the module under test, so no real
// network call is ever made.

const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------
// Resend SDK stub installed via require.cache
// ---------------------------------------------------------------------

const resendStub = {
  apiKeyArg: null,
  sendCalls: [],
  // Default behavior: succeed with a fake message id. Each test can
  // overwrite `nextResult` to drive a specific response, or set
  // `nextThrow` to make .send() reject.
  nextResult: { data: { id: 'msg_default' }, error: null },
  nextThrow: null,
  reset() {
    this.apiKeyArg = null;
    this.sendCalls = [];
    this.nextResult = { data: { id: 'msg_default' }, error: null };
    this.nextThrow = null;
  },
};

class FakeResend {
  constructor(apiKey) {
    resendStub.apiKeyArg = apiKey;
    this.emails = {
      send: async (payload) => {
        resendStub.sendCalls.push(payload);
        if (resendStub.nextThrow) throw resendStub.nextThrow;
        return resendStub.nextResult;
      },
    };
  }
}

const resendModulePath = require.resolve('resend');
require.cache[resendModulePath] = {
  id: resendModulePath,
  filename: resendModulePath,
  loaded: true,
  exports: { Resend: FakeResend },
};

const { sendAccessLinkEmail, renderEmailHtml } = require('../email_sender.js');

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const SAMPLE_INPUT = {
  to: 'user@example.com',
  firstName: 'Sample',
  reportId: 'PPC-2026-04-30-AB7QK',
  sessionEndDate: '2026-05-30T00:00:00.000Z',
};

test.beforeEach(() => {
  resendStub.reset();
  process.env.RESEND_API_KEY = 'test-key';
  process.env.SITE_URL = 'https://example.test';
});

test('returns success with messageId when Resend resolves', async () => {
  resendStub.nextResult = { data: { id: 'msg_abc' }, error: null };
  const out = await sendAccessLinkEmail(SAMPLE_INPUT);
  assert.equal(out.success, true);
  assert.equal(out.messageId, 'msg_abc');
  assert.equal(resendStub.apiKeyArg, 'test-key');
  assert.equal(resendStub.sendCalls.length, 1);
  const payload = resendStub.sendCalls[0];
  assert.deepEqual(payload.to, ['user@example.com']);
  assert.match(payload.from, /Patent PreCheck/);
  assert.match(payload.subject, /Interactive Code Review/);
  assert.match(payload.html, /Start your review/);
  // review URL embeds the report id and the configured SITE_URL
  assert.ok(
    payload.html.includes('https://example.test/review.html?id=PPC-2026-04-30-AB7QK'),
    'review URL is built from SITE_URL + reportId',
  );
});

test('returns error gracefully when Resend rejects (malformed input simulated)', async () => {
  resendStub.nextThrow = new Error('Invalid `to` field');
  const out = await sendAccessLinkEmail({ ...SAMPLE_INPUT, to: 'not-an-email' });
  assert.equal(out.success, false);
  assert.match(out.error, /Invalid/);
});

test('returns error when Resend response carries an error envelope (no throw)', async () => {
  resendStub.nextResult = { data: null, error: { message: 'Domain not verified' } };
  const out = await sendAccessLinkEmail(SAMPLE_INPUT);
  assert.equal(out.success, false);
  assert.match(out.error, /Domain not verified/);
});

test('returns error without crashing when RESEND_API_KEY is missing', async () => {
  delete process.env.RESEND_API_KEY;
  const out = await sendAccessLinkEmail(SAMPLE_INPUT);
  assert.equal(out.success, false);
  assert.match(out.error, /RESEND_API_KEY/);
  // Resend constructor was never reached
  assert.equal(resendStub.sendCalls.length, 0);
  assert.equal(resendStub.apiKeyArg, null);
});

test('renderEmailHtml escapes HTML in firstName to prevent injection', () => {
  const html = renderEmailHtml({
    firstName: '<script>alert(1)</script>',
    reviewUrl: 'https://example.test/review.html?id=X',
    sessionEndDate: '2026-05-30T00:00:00.000Z',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderEmailHtml falls back gracefully when firstName/sessionEndDate are missing', () => {
  const html = renderEmailHtml({
    firstName: '',
    reviewUrl: 'https://example.test/review.html?id=X',
    sessionEndDate: null,
  });
  assert.match(html, /Hi there,/);
  // No crash on missing date — generic 30-day window sentence still rendered
  assert.match(html, /30-day review window/);
});
