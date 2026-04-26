'use strict';

// Integration tests for the review-session Lambda. Stubs:
//   - @neondatabase/serverless: replace with capturing fake that
//     returns rowsByQuery from the test setup
//   - Anthropic SDK: replace via require.cache with a fake messages.create
//
// Pattern follows analyze.test.js / review-signup.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------
// Neon fake — supports queue of row-arrays per call
// ---------------------------------------------------------------------

const neonFake = {
  rowQueue: [],
  calls: [],
  reset() {
    this.rowQueue = [];
    this.calls = [];
  },
  enqueueRows(rows) {
    this.rowQueue.push(rows);
  },
  fn() {
    return async (text, params) => {
      neonFake.calls.push({ text, params });
      return neonFake.rowQueue.shift() || [];
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

// Anthropic fake — minimal class with messages.create(...)
const anthropicModulePath = require.resolve('@anthropic-ai/sdk');
const anthropicFake = {
  lastRequest: null,
  responseFn: () => ({
    content: [{ type: 'text', text: '{"bucket": "specific", "evidence_boost": 0}' }],
  }),
  reset() {
    this.lastRequest = null;
    this.responseFn = () => ({
      content: [{ type: 'text', text: '{"bucket": "specific", "evidence_boost": 0}' }],
    });
  },
};
class FakeAnthropic {
  constructor() {
    this.messages = {
      create: async (req) => {
        anthropicFake.lastRequest = req;
        return anthropicFake.responseFn(req);
      },
    };
  }
}
require.cache[anthropicModulePath] = {
  id: anthropicModulePath,
  filename: anthropicModulePath,
  loaded: true,
  exports: FakeAnthropic,
};

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/test';
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.ANTHROPIC_MODEL = 'claude-test';

const { handler } = require('../review-session.js');

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function postJson(body) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function asJson(res) {
  return JSON.parse(res.body);
}

function bypassRow({ session_state = null, completed = false } = {}) {
  return [
    {
      id: 'sig-uuid-1',
      access_method: 'beta_bypass',
      session_state,
      session_completed_at: completed ? new Date().toISOString() : null,
      input_hash: 'a'.repeat(64),
    },
  ];
}

function stripeRow() {
  return [
    {
      id: 'sig-uuid-2',
      access_method: 'stripe_payment',
      session_state: null,
      session_completed_at: null,
      input_hash: 'a'.repeat(64),
    },
  ];
}

test.beforeEach(() => {
  neonFake.reset();
  anthropicFake.reset();
});

// ---------------------------------------------------------------------
// Action validation
// ---------------------------------------------------------------------

test('rejects non-POST methods with 405', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(res.statusCode, 405);
});

test('rejects invalid JSON with 400', async () => {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: 'not json' });
  assert.equal(res.statusCode, 400);
});

test('rejects unknown action with 400', async () => {
  const res = await handler(postJson({ action: 'wat', report_id: 'x' }));
  assert.equal(res.statusCode, 400);
  assert.match(asJson(res).error, /action must be one of/);
});

test('rejects missing report_id with 400', async () => {
  const res = await handler(postJson({ action: 'start' }));
  assert.equal(res.statusCode, 400);
});

// ---------------------------------------------------------------------
// 404 / 402 paths
// ---------------------------------------------------------------------

test('returns 404 for unknown report_id', async () => {
  neonFake.enqueueRows([]); // signup lookup empty
  const res = await handler(postJson({ action: 'status', report_id: 'PPC-2026-01-01-XXXXX' }));
  assert.equal(res.statusCode, 404);
});

test('returns 402 for stripe_payment access_method', async () => {
  neonFake.enqueueRows(stripeRow());
  const res = await handler(postJson({ action: 'start', report_id: 'PPC-stripe-1' }));
  assert.equal(res.statusCode, 402);
  assert.match(asJson(res).error, /payment/i);
});

// ---------------------------------------------------------------------
// start
// ---------------------------------------------------------------------

test('start action initializes session_state and returns next_questions', async () => {
  neonFake.enqueueRows(bypassRow({ session_state: null }));
  neonFake.enqueueRows([]); // for the UPDATE
  const res = await handler(postJson({ action: 'start', report_id: 'PPC-2026-01-01-AAAAA' }));
  assert.equal(res.statusCode, 200);
  const body = asJson(res);
  assert.ok(body.session_state);
  assert.equal(body.session_state.version, 1);
  assert.ok(Array.isArray(body.next_questions));
  assert.ok(body.next_questions.length > 0);
});

test('start action returns 409 if session already started', async () => {
  neonFake.enqueueRows(bypassRow({ session_state: { version: 1, locked: false } }));
  const res = await handler(postJson({ action: 'start', report_id: 'PPC-already-1' }));
  assert.equal(res.statusCode, 409);
  assert.match(asJson(res).error, /already started/i);
});

// ---------------------------------------------------------------------
// answer
// ---------------------------------------------------------------------

test('answer action: scores via Claude, persists, returns delta + feedback', async () => {
  // Build a session_state matching what start would have produced
  const session = {
    version: 1,
    summary: '',
    claims: [{ id: 'claim_1', title: 'Anchor', score: 0 }],
    categories: { problem_framing: 0, constraints: 0, conception_moment: 0, decision_record: 0 },
    human_conception_strength: 0,
    questions_asked: [],
    questions_remaining: [
      {
        id: 'q_problem_framing_1',
        category: 'problem_framing',
        text: 'Describe the problem.',
        weight: 1.0,
      },
    ],
    answers: [],
    feedback_history: [],
    locked: false,
  };
  neonFake.enqueueRows(bypassRow({ session_state: session }));
  neonFake.enqueueRows([]); // UPDATE

  // Anthropic returns "specific" → 50%, expected delta 50
  anthropicFake.responseFn = () => ({
    content: [{ type: 'text', text: '{"bucket": "specific", "evidence_boost": 0}' }],
  });

  const res = await handler(
    postJson({
      action: 'answer',
      report_id: 'PPC-answer-1',
      question_id: 'q_problem_framing_1',
      answer_text: 'A specific articulation of the problem.',
    }),
  );
  assert.equal(res.statusCode, 200);
  const body = asJson(res);
  assert.equal(body.score_delta, 50);
  assert.equal(body.session_state.categories.problem_framing, 50);
  assert.match(body.feedback, /Strong specific answer/);
});

test('answer action returns 409 if session is locked', async () => {
  const session = {
    version: 1,
    locked: true,
    questions_remaining: [],
    questions_asked: [],
    answers: [],
    feedback_history: [],
    categories: { problem_framing: 0, constraints: 0, conception_moment: 0, decision_record: 0 },
    human_conception_strength: 0,
    summary: '',
    claims: [],
  };
  neonFake.enqueueRows(bypassRow({ session_state: session }));
  const res = await handler(
    postJson({
      action: 'answer',
      report_id: 'PPC-locked',
      question_id: 'q_problem_framing_1',
      answer_text: 'x',
    }),
  );
  assert.equal(res.statusCode, 409);
});

test('answer action returns 409 if session never started', async () => {
  neonFake.enqueueRows(bypassRow({ session_state: null }));
  const res = await handler(
    postJson({
      action: 'answer',
      report_id: 'PPC-empty',
      question_id: 'q_problem_framing_1',
      answer_text: 'x',
    }),
  );
  assert.equal(res.statusCode, 409);
});

// ---------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------

test('finalize action locks session, returns placeholder PDF URLs', async () => {
  const session = {
    version: 1,
    locked: false,
    questions_remaining: [],
    questions_asked: ['q_problem_framing_1'],
    answers: [],
    feedback_history: [],
    categories: {
      problem_framing: 50,
      constraints: 50,
      conception_moment: 50,
      decision_record: 50,
    },
    human_conception_strength: 50,
    summary: '',
    claims: [],
  };
  neonFake.enqueueRows(bypassRow({ session_state: session }));
  neonFake.enqueueRows([]); // UPDATE
  const res = await handler(postJson({ action: 'finalize', report_id: 'PPC-fin-1' }));
  assert.equal(res.statusCode, 200);
  const body = asJson(res);
  assert.equal(body.session_state.locked, true);
  assert.equal(body.idf_pdf_url, null);
  assert.equal(body.application_pdf_url, null);
  assert.equal(body.email_status, 'pending');
});

test('finalize action returns 409 if already finalized', async () => {
  const session = {
    version: 1,
    locked: true,
    questions_remaining: [],
    questions_asked: [],
    answers: [],
    feedback_history: [],
    categories: { problem_framing: 0, constraints: 0, conception_moment: 0, decision_record: 0 },
    human_conception_strength: 0,
    summary: '',
    claims: [],
  };
  neonFake.enqueueRows(bypassRow({ session_state: session }));
  const res = await handler(postJson({ action: 'finalize', report_id: 'PPC-fin-already' }));
  assert.equal(res.statusCode, 409);
});

// ---------------------------------------------------------------------
// status
// ---------------------------------------------------------------------

test('status action returns the current session_state', async () => {
  const session = {
    version: 1,
    locked: false,
    summary: 'Anchor summary',
    categories: { problem_framing: 30, constraints: 0, conception_moment: 0, decision_record: 0 },
    human_conception_strength: 7,
    claims: [],
    questions_asked: ['q_problem_framing_1'],
    questions_remaining: [],
    answers: [
      {
        question_id: 'q_problem_framing_1',
        answer_text: 'x',
        evidence_ids: [],
        ts: '2026-04-25T00:00:00Z',
      },
    ],
    feedback_history: ['Nice refinement — that adds real evidentiary weight.'],
  };
  neonFake.enqueueRows(bypassRow({ session_state: session }));
  const res = await handler(postJson({ action: 'status', report_id: 'PPC-status-1' }));
  assert.equal(res.statusCode, 200);
  const body = asJson(res);
  assert.equal(body.session_state.summary, 'Anchor summary');
  assert.equal(body.session_state.categories.problem_framing, 30);
});

test('status action returns null session_state when start has not been called', async () => {
  neonFake.enqueueRows(bypassRow({ session_state: null }));
  const res = await handler(postJson({ action: 'status', report_id: 'PPC-status-empty' }));
  assert.equal(res.statusCode, 200);
  const body = asJson(res);
  assert.equal(body.session_state, null);
});
