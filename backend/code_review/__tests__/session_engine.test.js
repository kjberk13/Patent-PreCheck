'use strict';

// Pure unit tests for the session-state engine. No DB, no HTTP, no
// Anthropic — the scoreAnswer adapter is injected as a stub.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATEGORY_KEYS,
  buildInitialSessionState,
  applyAnswer,
  finalizeSession,
  compositeHumanConceptionStrength,
  pickFeedbackMessage,
} = require('../session_engine.js');

function stubScoreAnswer(bucket, evidenceBoost = 0) {
  return async () => ({ bucket, evidenceBoost });
}

test('buildInitialSessionState returns version 1 with all categories at 0%', () => {
  const s = buildInitialSessionState();
  assert.equal(s.version, 1);
  assert.equal(s.locked, false);
  assert.equal(s.human_conception_strength, 0);
  for (const k of CATEGORY_KEYS) {
    assert.equal(s.categories[k], 0, `category ${k}`);
  }
  assert.ok(Array.isArray(s.questions_remaining));
  assert.ok(s.questions_remaining.length >= 3, 'initial batch has 3+ questions');
  assert.deepEqual(s.questions_asked, []);
  assert.deepEqual(s.answers, []);
  assert.deepEqual(s.feedback_history, []);
});

test('buildInitialSessionState derives claim candidates from priorScoring opportunities', () => {
  const priorScoring = {
    opportunities: [
      { area: 'Strengthen non-obviousness rationale' },
      { area: 'Document conception moment' },
      { area: 'Quantify utility benefit' },
      { area: 'Fourth opportunity not used' },
    ],
  };
  const s = buildInitialSessionState({ summary: 'A novel widget', priorScoring });
  assert.equal(s.claims.length, 3, 'caps at 3 claims');
  assert.equal(s.claims[0].title, 'Strengthen non-obviousness rationale');
  assert.equal(s.claims[0].score, 0);
});

test('buildInitialSessionState falls back to a single anchor claim when no priorScoring', () => {
  const s = buildInitialSessionState({ summary: 'Patent PreCheck widget summary' });
  assert.equal(s.claims.length, 1);
  assert.match(s.claims[0].title, /Patent PreCheck widget summary/);
});

test('applyAnswer with bucket=specific raises category to 50% and emits +30+ feedback', async () => {
  const s0 = buildInitialSessionState();
  const q = s0.questions_remaining[0]; // first remaining question
  const result = await applyAnswer(
    s0,
    { questionId: q.id, answerText: 'Specific technical answer' },
    { scoreAnswer: stubScoreAnswer('specific') },
  );
  assert.equal(result.session.categories[q.category], 50);
  assert.equal(result.delta, 50);
  assert.match(result.feedback, /Strong specific answer/);
  assert.equal(result.session.questions_asked.length, 1);
  assert.equal(result.session.answers[0].question_id, q.id);
});

test('applyAnswer with bucket=verified raises to 100% and saturates the category', async () => {
  const s0 = buildInitialSessionState();
  const q = s0.questions_remaining[0];
  const result = await applyAnswer(
    s0,
    { questionId: q.id, answerText: 'Specific + dated journal entry' },
    { scoreAnswer: stubScoreAnswer('verified') },
  );
  assert.equal(result.session.categories[q.category], 100);
  assert.equal(result.saturated_category, q.category);
  // Other questions in the same category should be filtered out of remaining
  const remainingInCategory = result.session.questions_remaining.filter(
    (qq) => qq.category === q.category,
  );
  assert.equal(remainingInCategory.length, 0);
});

test('applyAnswer never regresses a category score (max-merge with previous)', async () => {
  const s0 = buildInitialSessionState();
  const q = s0.questions_remaining[0];
  // First answer scores high
  const r1 = await applyAnswer(
    s0,
    { questionId: q.id, answerText: 'Strong answer' },
    { scoreAnswer: stubScoreAnswer('verified') },
  );
  assert.equal(r1.session.categories[q.category], 100);
  // Build a follow-up question in the same category for round 2
  const sameCategoryQ = {
    id: 'q_test_followup',
    category: q.category,
    text: 'A follow-up',
    weight: 0.5,
  };
  const sFollow = {
    ...r1.session,
    questions_remaining: [sameCategoryQ],
  };
  const r2 = await applyAnswer(
    sFollow,
    { questionId: 'q_test_followup', answerText: 'Weaker answer' },
    { scoreAnswer: stubScoreAnswer('vague') },
  );
  assert.equal(r2.session.categories[q.category], 100, 'category did not regress');
  assert.equal(r2.delta, 0);
});

test('applyAnswer rejects an answer for a session that is locked', async () => {
  const s0 = { ...buildInitialSessionState(), locked: true };
  const q = s0.questions_remaining[0];
  await assert.rejects(
    () =>
      applyAnswer(
        s0,
        { questionId: q.id, answerText: 'should fail' },
        { scoreAnswer: stubScoreAnswer('specific') },
      ),
    (err) => err.statusCode === 409 && /session_locked/.test(err.message),
  );
});

test('applyAnswer rejects unknown question ids with 400', async () => {
  const s0 = buildInitialSessionState();
  await assert.rejects(
    () =>
      applyAnswer(
        s0,
        { questionId: 'q_does_not_exist', answerText: 'x' },
        { scoreAnswer: stubScoreAnswer('specific') },
      ),
    (err) => err.statusCode === 400,
  );
});

test('applyAnswer rejects empty answers with 400', async () => {
  const s0 = buildInitialSessionState();
  const q = s0.questions_remaining[0];
  await assert.rejects(
    () =>
      applyAnswer(
        s0,
        { questionId: q.id, answerText: '   ' },
        { scoreAnswer: stubScoreAnswer('specific') },
      ),
    (err) => err.statusCode === 400,
  );
});

test('compositeHumanConceptionStrength averages the four category scores (rounded)', () => {
  assert.equal(
    compositeHumanConceptionStrength({
      problem_framing: 80,
      constraints: 60,
      conception_moment: 70,
      decision_record: 90,
    }),
    75,
  );
  assert.equal(
    compositeHumanConceptionStrength({
      problem_framing: 0,
      constraints: 0,
      conception_moment: 0,
      decision_record: 0,
    }),
    0,
  );
});

test('pickFeedbackMessage maps deltas to the LOCKED ENGINE_STATE.md patterns', () => {
  assert.match(pickFeedbackMessage(35), /Strong specific answer/);
  assert.match(pickFeedbackMessage(20), /Nice refinement/);
  assert.match(pickFeedbackMessage(8), /Every bit counts/);
  assert.match(pickFeedbackMessage(0), /didn.t change the score yet/);
  // Negative deltas can't actually occur (max-merge), but defensive.
  assert.match(pickFeedbackMessage(-5), /explore this dimension/);
});

test('finalizeSession sets locked=true, clears remaining questions, and stamps finalized_at', () => {
  const s0 = buildInitialSessionState();
  const fixedNow = new Date('2026-04-25T00:00:00Z');
  const finalized = finalizeSession(s0, { now: fixedNow });
  assert.equal(finalized.locked, true);
  assert.deepEqual(finalized.questions_remaining, []);
  assert.equal(finalized.finalized_at, '2026-04-25T00:00:00.000Z');
});

test('finalizeSession refuses to re-finalize an already-locked session', () => {
  const s0 = { ...buildInitialSessionState(), locked: true };
  assert.throws(
    () => finalizeSession(s0),
    (err) => err.statusCode === 409,
  );
});
