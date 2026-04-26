'use strict';

// =====================================================================
// Code Review — session-state engine
//
// Pure functions that take a session_state (JSON) + an input + an
// engine adapter, and return a new session_state + delta + feedback.
//
// The engine adapter is injected (not imported) so:
//   - tests can stub Anthropic without nock
//   - real production wires the actual Claude scoring call
//
// All locked behavior comes from ENGINE_STATE.md:
//   - Four evidence categories (problem_framing, constraints,
//     conception_moment, decision_record), each scored 0-100%
//   - Composite Human Conception Strength = average of the four
//     (per-claim weighting omitted in v1; single-claim sessions only)
//   - Five-tier scoring rubric: 0%, 15-25%, 40-60%, 70-85%, 100%
//   - Live-update feedback patterns by score-delta band
//   - Locked language: positive coaching, never "fail/failed/wrong"
//
// session_state shape (locked here, not in the brief — feel free to
// ratchet additional fields in later commits as long as version is
// bumped):
//
//   {
//     "version": 1,
//     "summary": string,                       // engine-generated, ≤500 chars
//     "claims": [{ id, title, score }, ...],   // claim candidates
//     "categories": {
//       "problem_framing": number,             // 0..100
//       "constraints": number,
//       "conception_moment": number,
//       "decision_record": number
//     },
//     "human_conception_strength": number,     // composite, 0..100
//     "questions_asked": [string, ...],        // question ids in order
//     "questions_remaining": [Question, ...],
//     "answers": [{ question_id, answer_text, evidence_ids, ts }, ...],
//     "feedback_history": [string, ...],
//     "locked": boolean
//   }
// =====================================================================

const CATEGORY_KEYS = Object.freeze([
  'problem_framing',
  'constraints',
  'conception_moment',
  'decision_record',
]);

// Initial question bank — minimal v1 set sourced from
// AI_Patentability_Inventor_Interview_Checklist.docx Parts I-II per
// FEATURES_STATE.md "Interactive session content" subsection. Commit 3
// moves the full bank to apps/website/data/code-review-questions.json
// and adds Part III (per-feature) + Part IV (declarations).
const QUESTION_BANK = Object.freeze([
  {
    id: 'q_problem_framing_1',
    category: 'problem_framing',
    text: 'Describe the specific technical problem this invention solves. What was failing in existing approaches?',
    hint: "Specific technical details, not just goals — what couldn't prior approaches do?",
    weight: 1.0,
  },
  {
    id: 'q_problem_framing_2',
    category: 'problem_framing',
    text: 'Did you identify the specific problem before prompting the AI, or did the AI suggest the problem?',
    hint: 'Pre-AI evidence (a journal note, an email, a Slack message) is high-value here.',
    weight: 0.9,
  },
  {
    id: 'q_constraints_1',
    category: 'constraints',
    text: 'What technical constraints shaped your approach (performance, memory, latency, domain rules)?',
    hint: "Specific numeric or domain-specific limits an AI prompt couldn't infer from training data.",
    weight: 1.0,
  },
  {
    id: 'q_constraints_2',
    category: 'constraints',
    text: 'Were there AI-generated parameters (thresholds, coefficients) you replaced with values from your own measurements?',
    hint: "Replaced values come from real-world tuning the AI couldn't have known.",
    weight: 0.8,
  },
  {
    id: 'q_conception_moment_1',
    category: 'conception_moment',
    text: 'When did you first articulate the specific solution (not a goal)?',
    hint: 'A timestamped record (commit, message, journal entry) showing when the solution crystallized.',
    weight: 1.0,
  },
  {
    id: 'q_conception_moment_2',
    category: 'conception_moment',
    text: 'Before using any AI tool, had you already formed a hypothesis about the approach?',
    hint: 'Pre-AI hypothesis evidence = strong conception story.',
    weight: 0.9,
  },
  {
    id: 'q_decision_record_1',
    category: 'decision_record',
    text: 'Describe a specific AI suggestion you rejected and why.',
    hint: 'Rejection rationale rooted in domain expertise carries weight under USPTO 2025 guidance.',
    weight: 1.0,
  },
  {
    id: 'q_decision_record_2',
    category: 'decision_record',
    text: 'Describe the most significant modification you made to an AI suggestion and why it was technically necessary.',
    hint: "What was changed, and why generic AI output wouldn't have worked.",
    weight: 0.9,
  },
]);

// ---------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------

// Build initial session_state from a free-tier scoring summary. The
// "claims" list is a placeholder stand-in derived from the summary's
// top opportunities — the real claim-extraction engine is Phase 3+
// scope (see OPEN_QUESTIONS.md).
function buildInitialSessionState({ summary = '', priorScoring = null } = {}) {
  const summaryStr = typeof summary === 'string' ? summary.slice(0, 500) : '';
  const claims = deriveClaimsFromScoring(priorScoring, summaryStr);
  return {
    version: 1,
    summary: summaryStr,
    claims,
    categories: {
      problem_framing: 0,
      constraints: 0,
      conception_moment: 0,
      decision_record: 0,
    },
    human_conception_strength: 0,
    questions_asked: [],
    questions_remaining: pickInitialQuestions(),
    answers: [],
    feedback_history: [],
    locked: false,
  };
}

// PLACEHOLDER claim-extraction. The brief explicitly calls this out:
// "the real claim-extraction engine is more sophisticated and is a
// follow-on engineering task." For Commit 2, derive 1-3 claim
// candidate titles from the free-tier scoring's top opportunities.
// If priorScoring is missing/empty, fall back to a single anchor claim
// derived from the invention summary.
function deriveClaimsFromScoring(priorScoring, summaryStr) {
  if (priorScoring && Array.isArray(priorScoring.opportunities)) {
    return priorScoring.opportunities.slice(0, 3).map((o, i) => ({
      id: `claim_${i + 1}`,
      title: typeof o.area === 'string' ? o.area : `Claim candidate ${i + 1}`,
      score: 0,
    }));
  }
  return [
    {
      id: 'claim_1',
      title: summaryStr ? summaryStr.slice(0, 80) : 'Primary claim candidate',
      score: 0,
    },
  ];
}

// Initial question batch (3-5 questions per the brief's `start` spec,
// drawn from each category's first question to give immediate breadth).
function pickInitialQuestions() {
  const seen = new Set();
  const picks = [];
  for (const q of QUESTION_BANK) {
    if (seen.has(q.category)) continue;
    seen.add(q.category);
    picks.push(q);
    if (picks.length >= 4) break;
  }
  return picks;
}

// ---------------------------------------------------------------------
// Answer evaluation
//
// scoreAnswer is async because the engine adapter typically calls
// Claude. For tests, pass a stubbed adapter that returns a deterministic
// rubric-bucket score.
// ---------------------------------------------------------------------

const RUBRIC_BUCKETS = Object.freeze({
  none: 0,
  vague: 20, // 15-25 midpoint
  specific: 50, // 40-60 midpoint
  documented: 78, // 70-85 midpoint
  verified: 100,
});

async function applyAnswer(session, { questionId, answerText, evidenceUploads = [] }, deps) {
  if (!session || typeof session !== 'object') {
    throw makeError(500, 'session_invalid');
  }
  if (session.locked) {
    throw makeError(409, 'session_locked');
  }
  const question = lookupQuestion(session, questionId);
  if (!question) {
    throw makeError(400, 'unknown_question');
  }
  if (typeof answerText !== 'string' || answerText.trim().length === 0) {
    throw makeError(400, 'empty_answer');
  }

  // Engine adapter is injected. Returns { bucket, evidenceBoost }.
  // Bucket maps to RUBRIC_BUCKETS; evidenceBoost is +0..40 added on top
  // when supporting evidence is present (per FEATURES_STATE.md
  // "How uploads translate to scores" subsection).
  const evaluation = await deps.scoreAnswer({
    category: question.category,
    questionText: question.text,
    answerText,
    evidenceUploads,
    inventionSummary: session.summary,
  });

  const bucketScore = RUBRIC_BUCKETS[evaluation.bucket] ?? 0;
  const evidenceBoost = clamp(Number(evaluation.evidenceBoost) || 0, 0, 40);
  const newCategoryScore = clamp(bucketScore + evidenceBoost, 0, 100);

  const previousCategoryScore = session.categories[question.category] ?? 0;
  // Take the max — answers are additive, never regressive. Per the
  // "Negative (rare): Never shown" feedback rule in ENGINE_STATE.md,
  // a worse-articulated re-answer doesn't drop the score.
  const updatedCategoryScore = Math.max(previousCategoryScore, newCategoryScore);
  const delta = updatedCategoryScore - previousCategoryScore;

  const nextCategories = { ...session.categories, [question.category]: updatedCategoryScore };
  const composite = compositeHumanConceptionStrength(nextCategories);

  const feedback = pickFeedbackMessage(delta);

  // Drop the answered question from `questions_remaining`; if its
  // category is now saturated (>= 90), drop other questions from
  // that category too — per the brief's adaptive question-load rule
  // ("if a category hits 90%+ score, skip remaining questions in that
  // category").
  const saturated = updatedCategoryScore >= 90;
  const remaining = session.questions_remaining.filter((q) => {
    if (q.id === questionId) return false;
    if (saturated && q.category === question.category) return false;
    return true;
  });

  const nextQuestion = remaining[0] || null;

  const newSession = {
    ...session,
    categories: nextCategories,
    human_conception_strength: composite,
    questions_asked: [...session.questions_asked, questionId],
    questions_remaining: remaining,
    answers: [
      ...session.answers,
      {
        question_id: questionId,
        answer_text: answerText.slice(0, 5000),
        evidence_ids: evidenceUploads.map((e) => e.id).filter(Boolean),
        ts: new Date().toISOString(),
      },
    ],
    feedback_history: [...session.feedback_history, feedback],
  };

  return {
    session: newSession,
    delta,
    feedback,
    next_question: nextQuestion,
    saturated_category: saturated ? question.category : null,
  };
}

function lookupQuestion(session, questionId) {
  const fromRemaining = session.questions_remaining.find((q) => q.id === questionId);
  if (fromRemaining) return fromRemaining;
  return QUESTION_BANK.find((q) => q.id === questionId) || null;
}

function compositeHumanConceptionStrength(categories) {
  let sum = 0;
  for (const k of CATEGORY_KEYS) sum += categories[k] || 0;
  return Math.round(sum / CATEGORY_KEYS.length);
}

// Live-update feedback patterns — LOCKED in ENGINE_STATE.md.
function pickFeedbackMessage(delta) {
  if (delta >= 30) {
    return "Strong specific answer — that's the evidence examiners look for.";
  }
  if (delta >= 15) {
    return 'Nice refinement — that adds real evidentiary weight.';
  }
  if (delta >= 5) {
    return "Every bit counts. That's a step forward.";
  }
  if (delta === 0) {
    return "Your answer didn't change the score yet, but it adds to your documentation record. Can you add a specific example or date?";
  }
  // Negative deltas can't actually happen because applyAnswer takes
  // max(prev, new). Defensive fallback for the rare case.
  return "Thanks for the clarification. Let's explore this dimension further in the next question.";
}

// ---------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------

function finalizeSession(session, { now = new Date() } = {}) {
  if (!session || typeof session !== 'object') {
    throw makeError(500, 'session_invalid');
  }
  if (session.locked) {
    throw makeError(409, 'session_already_finalized');
  }
  return {
    ...session,
    locked: true,
    questions_remaining: [],
    finalized_at: now.toISOString(),
  };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function makeError(statusCode, code) {
  const err = new Error(code);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

module.exports = {
  CATEGORY_KEYS,
  QUESTION_BANK,
  RUBRIC_BUCKETS,
  buildInitialSessionState,
  applyAnswer,
  finalizeSession,
  compositeHumanConceptionStrength,
  pickFeedbackMessage,
};
