'use strict';

// =====================================================================
// Netlify Function: review-session
//
// Routes the four interactive-review actions per phase-2.7-brief.md:
//
//   start    → load signup, verify access_method, build initial
//              session_state, return first batch of questions
//   answer   → score the user's answer with the ENGINE_STATE.md rubric,
//              update categories + composite, return delta + feedback
//   finalize → lock the session, set session_completed_at, return
//              placeholder PDF URLs (Commit 4 generates real PDFs)
//   status   → return the current session_state (used for resume + the
//              post-finalize web view)
//
// Body shape (JSON):
//   { action: 'start'|'answer'|'finalize'|'status', report_id, ... }
//
// Error taxonomy (per brief):
//   400 — bad params / malformed body
//   401 — signup_id mismatch (someone else's session)
//   402 — non-bypass access attempt
//   404 — invalid report_id
//   409 — action invalid for current state (e.g. answer after finalize)
//   500 — internal error (logged, opaque message returned)
// =====================================================================

const Anthropic = require('@anthropic-ai/sdk');

const {
  respond,
  CORS_HEADERS,
  parseJsonBody,
  buildSqlClient,
  log,
} = require('../../backend/code_review/review_helpers.js');

const {
  buildInitialSessionState,
  applyAnswer,
  finalizeSession,
  RUBRIC_BUCKETS,
  CATEGORY_KEYS,
} = require('../../backend/code_review/session_engine.js');

const VALID_ACTIONS = new Set(['start', 'answer', 'finalize', 'status']);

// ---------------------------------------------------------------------
// In-memory rate limiter, per signup_id.
//
// Cold-start caveat: Lambda instances reset on cold start, so the 24h
// window is best-effort. This is good enough for v1 abuse prevention;
// Phase 4 moves to Redis or a DB-backed limiter (see brief). The map
// lives at module scope so warm Lambda invocations share state.
// ---------------------------------------------------------------------

const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMITS = Object.freeze({
  answer: 100,
  evidence: 50, // counted via answer.evidence_uploads.length
  finalize: 3,
});

const _rateBuckets = new Map(); // signupId → { answer, evidence, finalize, windowStart }

function checkRateLimit(signupId, kind, increment = 1) {
  const now = Date.now();
  let bucket = _rateBuckets.get(signupId);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    bucket = { answer: 0, evidence: 0, finalize: 0, windowStart: now };
    _rateBuckets.set(signupId, bucket);
  }
  if (bucket[kind] + increment > RATE_LIMITS[kind]) {
    return false;
  }
  bucket[kind] += increment;
  return true;
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = parseJsonBody(event.body);
  } catch (err) {
    return respond(400, { error: err.message || 'Invalid JSON body' });
  }

  const action = String(body.action || '').toLowerCase();
  const reportId = body.report_id;

  if (!VALID_ACTIONS.has(action)) {
    return respond(400, {
      error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}`,
    });
  }
  if (typeof reportId !== 'string' || reportId.length === 0) {
    return respond(400, { error: 'report_id is required' });
  }

  const sql = buildSqlClient();
  if (!sql) {
    log('error', { event: 'review_session_db_unavailable', action });
    return respond(500, { error: 'Service is not currently configured.' });
  }

  // Look up the signup row. Every action needs it.
  const signupRows = await sql(
    `SELECT id, access_method, session_state, session_completed_at, input_hash
     FROM code_review_signups
     WHERE report_id = $1`,
    [reportId],
  );
  if (!signupRows || signupRows.length === 0) {
    return respond(404, { error: 'No review session found for that report ID.' });
  }
  const signup = signupRows[0];

  if (signup.access_method !== 'beta_bypass') {
    // stripe_payment rows are reserved seats — Phase 4 wires the actual
    // session creation behind the Stripe webhook. For Phase 2.7 the
    // client renders a "Payment coming soon" message off this 402.
    return respond(402, {
      error:
        'This review requires payment to start. Stripe integration is coming soon — we will contact you when paid signups open.',
    });
  }

  try {
    if (action === 'status') {
      return respond(200, { report_id: reportId, session_state: signup.session_state || null });
    }

    if (action === 'start') {
      if (signup.session_state) {
        return respond(409, {
          error: 'Session already started for this report ID. Use action=status to resume.',
        });
      }
      const initial = buildInitialSessionState({ summary: '', priorScoring: null });
      await persistSessionState(sql, signup.id, initial);
      log('info', { event: 'review_session_started', report_id: reportId });
      return respond(200, {
        report_id: reportId,
        session_state: initial,
        next_questions: initial.questions_remaining.slice(0, 4),
      });
    }

    if (action === 'answer') {
      const session = signup.session_state;
      if (!session) {
        return respond(409, { error: 'Session has not been started. POST action=start first.' });
      }
      if (session.locked) {
        return respond(409, { error: 'Session is finalized — no further answers accepted.' });
      }
      if (!checkRateLimit(signup.id, 'answer', 1)) {
        return respond(429, {
          error: 'Too many answers in 24 hours. Please pause and resume later.',
        });
      }
      const evidenceUploads = Array.isArray(body.evidence_uploads) ? body.evidence_uploads : [];
      if (evidenceUploads.length > 0) {
        if (!checkRateLimit(signup.id, 'evidence', evidenceUploads.length)) {
          return respond(429, {
            error: 'Too many evidence uploads in 24 hours. Please pause and resume later.',
          });
        }
      }
      const result = await applyAnswer(
        session,
        {
          questionId: body.question_id,
          answerText: body.answer_text,
          evidenceUploads,
        },
        { scoreAnswer: claudeScoreAnswerAdapter() },
      );
      await persistSessionState(sql, signup.id, result.session);
      log('info', {
        event: 'review_session_answer',
        report_id: reportId,
        question_id: body.question_id,
        delta: result.delta,
      });
      return respond(200, {
        report_id: reportId,
        session_state: result.session,
        score_delta: result.delta,
        feedback: result.feedback,
        next_question: result.next_question,
        saturated_category: result.saturated_category,
      });
    }

    if (action === 'finalize') {
      const session = signup.session_state;
      if (!session) {
        return respond(409, { error: 'Session has not been started.' });
      }
      if (session.locked) {
        return respond(409, { error: 'Session is already finalized.' });
      }
      if (!checkRateLimit(signup.id, 'finalize', 1)) {
        return respond(429, { error: 'Too many finalize attempts. Please contact support.' });
      }
      const finalized = finalizeSession(session);
      const completedAt = new Date();
      await sql(
        `UPDATE code_review_signups
         SET session_state = $1, session_completed_at = $2
         WHERE id = $3`,
        [JSON.stringify(finalized), completedAt.toISOString(), signup.id],
      );
      log('info', { event: 'review_session_finalized', report_id: reportId });
      // PDF URLs are Commit 4 scope — return null placeholders so the
      // client can render "Generating your report…" UI; Commit 4 wires
      // puppeteer-core + @sparticuz/chromium and updates the columns.
      return respond(200, {
        report_id: reportId,
        session_state: finalized,
        idf_pdf_url: null,
        application_pdf_url: null,
        email_status: 'pending',
        message: 'Session finalized. PDF generation and email delivery are coming soon (Commit 4).',
      });
    }
  } catch (err) {
    if (err && err.statusCode) {
      return respond(err.statusCode, { error: err.message || 'Request failed', code: err.code });
    }
    log('error', { event: 'review_session_unhandled_error', error: err.message });
    return respond(500, { error: 'Something went wrong. Please try again shortly.' });
  }

  // Defensive: VALID_ACTIONS.has(...) above means we should never
  // reach this point. If we do, surface a 500.
  return respond(500, { error: 'Unhandled action.' });
};

async function persistSessionState(sql, signupId, sessionState) {
  await sql(`UPDATE code_review_signups SET session_state = $1 WHERE id = $2`, [
    JSON.stringify(sessionState),
    signupId,
  ]);
}

// ---------------------------------------------------------------------
// Claude scoring adapter
//
// Maps Claude's structured output to a rubric bucket per
// ENGINE_STATE.md. Returns { bucket, evidenceBoost }. The bucket is
// one of RUBRIC_BUCKETS' keys: none / vague / specific / documented /
// verified. evidenceBoost is +0..40 added when supporting evidence is
// present.
//
// For Commit 2, this is a thin Claude wrapper. The real per-category
// rubric prompts get refined in Commit 3 once we have user-test data;
// for now we use a single-shot classifier prompt that maps to the
// five-bucket scale.
// ---------------------------------------------------------------------

function claudeScoreAnswerAdapter() {
  return async function scoreAnswer({ category, questionText, answerText, evidenceUploads }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Graceful degradation — without an API key we return a
      // mid-tier "specific" bucket so the engine still progresses
      // during local testing without secrets configured.
      log('warn', { event: 'review_session_anthropic_key_missing' });
      return { bucket: 'specific', evidenceBoost: evidenceUploads.length > 0 ? 10 : 0 };
    }
    const anthropic = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
    const prompt = buildScoringPrompt({
      category,
      questionText,
      answerText,
      evidenceCount: evidenceUploads.length,
    });
    let response;
    try {
      response = await anthropic.messages.create({
        model,
        max_tokens: 256,
        system:
          'You are a USPTO-aware patentability scoring assistant. You only emit JSON matching the requested schema; no prose.',
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      log('warn', { event: 'review_session_anthropic_call_failed', error: err.message });
      return { bucket: 'specific', evidenceBoost: 0 };
    }
    const text = extractText(response);
    const parsed = safeParseJson(text);
    const bucket =
      parsed && Object.keys(RUBRIC_BUCKETS).includes(parsed.bucket) ? parsed.bucket : 'specific';
    const evidenceBoost = clampNum(parsed && parsed.evidence_boost, 0, 40);
    return { bucket, evidenceBoost };
  };
}

function buildScoringPrompt({ category, questionText, answerText, evidenceCount }) {
  const categoryLabel = CATEGORY_KEYS.includes(category) ? category : 'unknown';
  return `Score the user's answer against the 5-tier rubric for the "${categoryLabel}" evidence category.

Question asked: ${questionText}

User's answer:
"""
${answerText.slice(0, 2000)}
"""

Supporting documents attached: ${evidenceCount}

Rubric buckets:
- "none": no answer / no evidence
- "vague": goal-level only (e.g. "I wanted to solve X")
- "specific": specific answer, no supporting documentation
- "documented": specific answer + reference to documentation (commit, journal, email)
- "verified": specific answer + timestamped/verifiable documentation

Rules:
- Only natural-person conception qualifies for "documented" or "verified"
- evidence_boost: 0..40, scaled by how directly the supporting documents corroborate the claim
- Output JSON: {"bucket": "<bucket>", "evidence_boost": <int>}`;
}

function extractText(response) {
  if (!response || !Array.isArray(response.content)) return '';
  for (const block of response.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}

function safeParseJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clampNum(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}
