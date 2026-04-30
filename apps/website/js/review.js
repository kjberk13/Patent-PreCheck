'use strict';

// =====================================================================
// /review.html — single-page Q&A flow for the Interactive Code Review.
//
// Renders one of seven UI states based on a status call to the
// review-session Lambda:
//
//   loading          — initial render while status is in flight
//   welcome_back     — in_progress, ≥1 answer logged
//   ready_to_finalize — all questions answered, not finalized
//   active_qa        — answering a question (with sticky score bar)
//   review           — list of answered questions, edit + finalize
//   finalizing       — between finalize click and final state
//   scorecard        — locked final result
//   error            — anything else (404, 500, expired, etc.)
//
// State data lives in App. The DOM is re-rendered top-down by render*().
// No framework — vanilla JS keeps the page bundle small and the failure
// modes shallow.
// =====================================================================

(function () {
  const ENDPOINT = '/.netlify/functions/review-session';
  const LOCAL_KEY = 'patent-precheck-active-review';
  const FEEDBACK_DWELL_MS = 1200;

  const PILLAR_BY_CATEGORY = {
    problem_framing: { num: 1, label: 'Problem framing' },
    constraints: { num: 2, label: 'Constraints' },
    conception_moment: { num: 3, label: 'Conception moment' },
    decision_record: { num: 4, label: 'Decision record' },
  };
  const CATEGORY_KEYS = ['problem_framing', 'constraints', 'conception_moment', 'decision_record'];

  const App = {
    reportId: null,
    statusBody: null, // last status response
    activeQuestionId: null, // for active_qa
  };

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------

  function init() {
    const params = new URLSearchParams(window.location.search);
    let id = params.get('id');
    if (!id) {
      try {
        id = localStorage.getItem(LOCAL_KEY);
      } catch (err) {
        id = null;
      }
      if (id) {
        window.location.replace('/review.html?id=' + encodeURIComponent(id));
        return;
      }
      window.location.replace('/analyze.html');
      return;
    }
    App.reportId = id;
    fetchAndRoute();
  }

  async function fetchAndRoute() {
    showLoading();
    try {
      const res = await postAction('status', {});
      if (!res.ok) {
        if (res.status === 404) {
          renderError({ title: 'Session not found', message: 'We could not find a review for that link. The session may have been deleted, or the link may be incorrect.', clearLocal: true });
          return;
        }
        renderError({ title: 'Something went wrong', message: 'We could not load your review session. Please try again in a moment.' });
        return;
      }
      App.statusBody = res.body;
      routeFromStatus(res.body);
    } catch (err) {
      renderError({ title: 'Connection problem', message: 'We could not reach the server. Check your connection and try again.' });
    }
  }

  function routeFromStatus(body) {
    const state = body && body.state;
    if (state === 'expired') {
      renderError({ title: 'Session expired', message: 'Your 30-day review window has ended. Your scores are saved, but no further answers can be added.', clearLocal: true });
      return;
    }
    if (state === 'finalized') {
      renderScorecard(body.session_state);
      return;
    }
    if (state === 'not_started') {
      // Auto-start so the user lands directly in the first question.
      startSessionThenRoute();
      return;
    }
    if (state === 'ready_to_finalize') {
      renderWelcomeBack(body, /* readyToFinalize */ true);
      return;
    }
    // in_progress (default)
    const session = body.session_state || {};
    const askedCount = Array.isArray(session.questions_asked) ? session.questions_asked.length : 0;
    if (askedCount === 0) {
      // Edge case: state=in_progress but no questions asked yet — just
      // jump straight into the first question.
      const first = (session.questions_remaining || [])[0];
      if (first) {
        renderActiveQA(session, first.id);
        return;
      }
    }
    renderWelcomeBack(body, /* readyToFinalize */ false);
  }

  async function startSessionThenRoute() {
    showLoading('Setting up your review...');
    try {
      const res = await postAction('start', {});
      if (!res.ok) {
        renderError({ title: 'Something went wrong', message: 'We could not start your review session. Please try again in a moment.' });
        return;
      }
      App.statusBody = Object.assign({}, App.statusBody || {}, {
        session_state: res.body.session_state,
        state: 'in_progress',
      });
      const first = (res.body.next_questions || [])[0];
      if (!first) {
        renderError({ title: 'No questions available', message: 'Your session is set up but no questions are queued. Please contact support.' });
        return;
      }
      renderActiveQA(res.body.session_state, first.id);
    } catch (err) {
      renderError({ title: 'Connection problem', message: 'We could not reach the server. Check your connection and try again.' });
    }
  }

  // -------------------------------------------------------------------
  // Networking
  // -------------------------------------------------------------------

  async function postAction(action, extra) {
    const payload = Object.assign({ action: action, report_id: App.reportId }, extra || {});
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let body = null;
    try {
      body = await r.json();
    } catch (err) {
      body = null;
    }
    return { ok: r.ok, status: r.status, body: body };
  }

  // -------------------------------------------------------------------
  // Score bar
  // -------------------------------------------------------------------

  function showScoreBar(visible) {
    const bar = document.getElementById('scoreBar');
    if (bar) bar.hidden = !visible;
  }

  function updateScoreBar(session, opts) {
    if (!session) return;
    const composite = Number(session.human_conception_strength) || 0;
    const compositeEl = document.getElementById('scoreComposite');
    if (compositeEl) compositeEl.textContent = String(composite);
    const cats = session.categories || {};
    const bar = document.getElementById('scoreBar');
    if (!bar) return;
    CATEGORY_KEYS.forEach((cat) => {
      const cell = bar.querySelector('.score-cat[data-cat="' + cat + '"]');
      if (!cell) return;
      const num = Number(cats[cat]) || 0;
      const numEl = cell.querySelector('.score-cat-num');
      const fillEl = cell.querySelector('.score-cat-bar-fill');
      if (numEl) {
        numEl.textContent = String(num);
        numEl.classList.toggle('has-score', num > 0);
      }
      if (fillEl) fillEl.style.width = Math.max(0, Math.min(100, num)) + '%';
    });
    const finalTag = document.getElementById('scoreFinalTag');
    if (finalTag) finalTag.hidden = !(opts && opts.finalLocked);
  }

  function flashDelta(delta) {
    const el = document.getElementById('scoreDelta');
    if (!el || !delta || delta <= 0) return;
    el.textContent = '+' + delta;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
  }

  // -------------------------------------------------------------------
  // State renderers
  // -------------------------------------------------------------------

  function appEl() {
    return document.getElementById('app');
  }

  function showLoading(label) {
    showScoreBar(false);
    const heading = label || 'Loading your review...';
    appEl().innerHTML =
      '<div class="card spinner-card">' +
      '<div class="spinner" aria-hidden="true"></div>' +
      '<div class="card-h" style="font-size:20px">' + escapeHtml(heading) + '</div>' +
      '</div>';
  }

  function renderError(opts) {
    if (opts && opts.clearLocal) {
      try { localStorage.removeItem(LOCAL_KEY); } catch (err) { /* ignore */ }
    }
    showScoreBar(false);
    const title = (opts && opts.title) || 'Something went wrong';
    const message = (opts && opts.message) || 'Please try again in a moment.';
    appEl().innerHTML =
      '<div class="card spinner-card">' +
      '<div class="error-icon" aria-hidden="true">!</div>' +
      '<div class="card-h" style="font-size:22px;margin-bottom:8px">' + escapeHtml(title) + '</div>' +
      '<div class="card-sub" style="max-width:440px;margin:0 auto 18px">' + escapeHtml(message) + '</div>' +
      '<div class="button-row" style="justify-content:center">' +
      '<button class="btn btn-primary" id="errorRetry">Try again</button>' +
      '<a class="btn-link" href="/">Back to home</a>' +
      '</div>' +
      '</div>';
    const retry = document.getElementById('errorRetry');
    if (retry) retry.addEventListener('click', fetchAndRoute);
  }

  function renderWelcomeBack(body, readyToFinalize) {
    const session = body.session_state || {};
    showScoreBar(true);
    updateScoreBar(session, {});

    const firstName = (body.first_name || '').trim();
    const askedCount = (session.questions_asked || []).length;
    const lastTs = lastAnswerTs(session);
    const sessionEnd = body.session_end_date ? formatDate(body.session_end_date) : '';

    const upNext = (session.questions_remaining || [])[0];

    let card;
    if (readyToFinalize) {
      card =
        '<div class="card">' +
        (firstName ? '<div class="card-eyebrow">Welcome back, ' + escapeHtml(firstName) + '</div>' : '') +
        '<div class="card-h">Ready to finalize your review</div>' +
        '<div class="card-sub">All questions answered. Your scores are locked in unless you finalize.</div>' +
        '<div class="button-row">' +
        '<button class="btn btn-primary" id="goReview">Review and finalize &rarr;</button>' +
        '</div>' +
        '</div>';
    } else {
      const subBits = [];
      if (lastTs) subBits.push('Last activity: ' + formatRelative(lastTs));
      if (sessionEnd) subBits.push('Session expires ' + sessionEnd);
      const subText = subBits.join(' · ');
      const upNextHtml = upNext
        ? '<div class="up-next">' +
          '<div class="up-next-eyebrow">Up next · ' + escapeHtml(pillarLabel(upNext.category)) + '</div>' +
          '<div class="up-next-text">' + escapeHtml(upNext.text || '') + '</div>' +
          '</div>'
        : '';
      card =
        '<div class="card">' +
        (firstName ? '<div class="card-eyebrow">Welcome back, ' + escapeHtml(firstName) + '</div>' : '<div class="card-eyebrow">Welcome back</div>') +
        '<div class="card-h">You’re ' + askedCount + ' question' + (askedCount === 1 ? '' : 's') + ' in</div>' +
        (subText ? '<div class="card-sub">' + escapeHtml(subText) + '</div>' : '') +
        upNextHtml +
        '<div class="button-row">' +
        (upNext ? '<button class="btn btn-primary" id="goContinue">Continue where you left off &rarr;</button>' : '') +
        (askedCount > 0 ? '<button class="btn btn-secondary" id="goReviewPast">Review past answers</button>' : '') +
        '</div>' +
        '</div>';
    }

    appEl().innerHTML = card;
    const goReview = document.getElementById('goReview');
    if (goReview) goReview.addEventListener('click', () => renderReview(session, /* allowFinalize */ true));
    const goReviewPast = document.getElementById('goReviewPast');
    if (goReviewPast) goReviewPast.addEventListener('click', () => renderReview(session, /* allowFinalize */ false));
    const goContinue = document.getElementById('goContinue');
    if (goContinue && upNext) goContinue.addEventListener('click', () => renderActiveQA(session, upNext.id));
  }

  function renderActiveQA(session, questionId) {
    showScoreBar(true);
    updateScoreBar(session, {});
    App.activeQuestionId = questionId;

    const question = lookupQuestion(session, questionId);
    if (!question) {
      renderError({ title: 'Question not found', message: 'We could not load the next question for you. Please reload the page.' });
      return;
    }

    const previousAnswer = findPreviousAnswerText(session, questionId);
    const remaining = (session.questions_remaining || []).filter((q) => q.id !== questionId);
    const isLast = remaining.length === 0;
    const submitLabel = isLast ? 'Submit answer &rarr;' : 'Submit answer &rarr;';

    const askedHistory = session.questions_asked || [];
    const previousId = askedHistory.length > 0 ? askedHistory[askedHistory.length - 1] : null;

    const pillar = pillarFor(question.category);

    appEl().innerHTML =
      '<div class="card">' +
      '<div class="q-eyebrow">Pillar ' + pillar.num + ' &middot; ' + escapeHtml(pillar.label) + '</div>' +
      '<div class="q-text">' + escapeHtml(question.text || '') + '</div>' +
      (question.hint ? '<div class="q-hint">' + escapeHtml(question.hint) + '</div>' : '') +
      '<textarea class="q-textarea" id="qInput" placeholder="Your answer..." aria-label="Your answer"></textarea>' +
      '<div class="q-error" id="qError" role="alert"></div>' +
      '<div class="q-feedback" id="qFeedback" role="status"></div>' +
      '<div class="q-footer">' +
      '<div>' +
      (previousId && previousId !== questionId
        ? '<button class="btn-link" id="qPrev">&larr; Previous</button>'
        : '') +
      '</div>' +
      '<button class="btn btn-primary" id="qSubmit">' + submitLabel + '</button>' +
      '</div>' +
      '</div>';

    const input = document.getElementById('qInput');
    if (input && previousAnswer) input.value = previousAnswer;
    if (input) input.focus();

    const submitBtn = document.getElementById('qSubmit');
    if (submitBtn) submitBtn.addEventListener('click', () => submitAnswer(session, question));

    const prevBtn = document.getElementById('qPrev');
    if (prevBtn && previousId) {
      prevBtn.addEventListener('click', () => {
        renderActiveQA(session, previousId);
      });
    }
  }

  async function submitAnswer(session, question) {
    const input = document.getElementById('qInput');
    const errEl = document.getElementById('qError');
    const fbEl = document.getElementById('qFeedback');
    const submitBtn = document.getElementById('qSubmit');
    if (!input || !submitBtn) return;

    const text = (input.value || '').trim();
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.remove('shown');
    }
    if (fbEl) {
      fbEl.textContent = '';
      fbEl.classList.remove('shown');
    }

    if (!text) {
      if (errEl) {
        errEl.textContent = 'Please provide an answer.';
        errEl.classList.add('shown');
      }
      return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.innerHTML;
    submitBtn.textContent = 'Saving...';

    let res;
    try {
      res = await postAction('answer', {
        question_id: question.id,
        answer_text: text,
      });
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
      if (errEl) {
        errEl.textContent = 'Could not save your answer. Please try again.';
        errEl.classList.add('shown');
      }
      return;
    }

    if (!res.ok) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
      if (errEl) {
        const msg = (res.body && res.body.error) || 'Could not save your answer. Please try again.';
        errEl.textContent = msg;
        errEl.classList.add('shown');
      }
      return;
    }

    const newSession = res.body.session_state;
    const delta = Number(res.body.score_delta) || 0;
    const feedback = res.body.feedback || '';
    const nextQuestion = res.body.next_question;

    updateScoreBar(newSession, {});
    flashDelta(delta);
    if (fbEl && feedback) {
      fbEl.textContent = feedback;
      fbEl.classList.add('shown');
    }

    setTimeout(() => {
      App.statusBody = Object.assign({}, App.statusBody || {}, { session_state: newSession });
      if (nextQuestion) {
        renderActiveQA(newSession, nextQuestion.id);
      } else {
        renderReview(newSession, /* allowFinalize */ true);
      }
    }, FEEDBACK_DWELL_MS);
  }

  function renderReview(session, allowFinalize) {
    showScoreBar(true);
    updateScoreBar(session, {});

    const answers = session.answers || [];
    const questionsAsked = session.questions_asked || [];
    const items = questionsAsked.map((qid, idx) => {
      const question = lookupQuestion(session, qid);
      const ans = answers.find((a) => a.question_id === qid);
      const pillar = question ? pillarFor(question.category) : { num: 0, label: '' };
      return {
        questionId: qid,
        index: idx + 1,
        pillarNum: pillar.num,
        pillarLabel: pillar.label,
        questionText: question ? question.text : '(question text unavailable)',
        answerText: ans ? ans.answer_text : '',
      };
    });

    const showAll = items.length <= 5;
    const visible = showAll ? items : items.slice(0, 4);
    const hiddenCount = items.length - visible.length;

    const itemHtml = visible.map((it) => renderReviewItem(it)).join('');
    const expandHtml = hiddenCount > 0
      ? '<button class="review-show-more" id="reviewShowAll">+ ' + hiddenCount + ' more answers · View all</button>'
      : '';

    const banner = allowFinalize
      ? '<div class="review-banner"><strong>Heads up:</strong> Once you finalize, scores lock in and your final report will be generated. You can still re-run analysis on a new project anytime.</div>'
      : '';

    const footerRow = allowFinalize
      ? '<div class="button-row">' +
        '<button class="btn-link" id="reviewBack">&larr; Back to last question</button>' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-primary" id="reviewFinalize">Finalize my review &rarr;</button>' +
        '</div>'
      : '<div class="button-row">' +
        '<button class="btn-link" id="reviewBack">&larr; Back</button>' +
        '</div>';

    appEl().innerHTML =
      '<div class="card">' +
      '<div class="card-h">Review your answers' + (allowFinalize ? ' before finalizing' : '') + '</div>' +
      '<div class="card-sub">You can edit any answer.' + (allowFinalize ? ' After finalizing, your scores are locked and a dated PDF is generated.' : '') + '</div>' +
      '<div class="review-list" id="reviewList">' + itemHtml + '</div>' +
      expandHtml +
      banner +
      footerRow +
      '</div>';

    if (hiddenCount > 0) {
      const showAllBtn = document.getElementById('reviewShowAll');
      if (showAllBtn) {
        showAllBtn.addEventListener('click', () => {
          const list = document.getElementById('reviewList');
          if (list) list.innerHTML = items.map((it) => renderReviewItem(it)).join('');
          showAllBtn.remove();
          wireReviewEditButtons(session);
        });
      }
    }

    wireReviewEditButtons(session);

    const backBtn = document.getElementById('reviewBack');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const lastId = questionsAsked.length > 0 ? questionsAsked[questionsAsked.length - 1] : null;
        const upNext = (session.questions_remaining || [])[0];
        if (lastId) {
          renderActiveQA(session, lastId);
        } else if (upNext) {
          renderActiveQA(session, upNext.id);
        } else {
          renderWelcomeBack(App.statusBody || { session_state: session }, /* readyToFinalize */ true);
        }
      });
    }

    const finalizeBtn = document.getElementById('reviewFinalize');
    if (finalizeBtn) finalizeBtn.addEventListener('click', () => finalizeFlow(session));
  }

  function renderReviewItem(it) {
    const truncated = truncate(it.answerText, 200);
    return (
      '<div class="review-item">' +
      '<div class="review-item-body">' +
      '<div class="review-item-eyebrow">Pillar ' + it.pillarNum + ' &middot; Q' + it.index + '</div>' +
      '<div class="review-item-q">' + escapeHtml(it.questionText) + '</div>' +
      '<div class="review-item-a">' + escapeHtml(truncated) + '</div>' +
      '</div>' +
      '<a href="#" class="review-item-edit" data-qid="' + escapeAttr(it.questionId) + '">Edit</a>' +
      '</div>'
    );
  }

  function wireReviewEditButtons(session) {
    const links = document.querySelectorAll('.review-item-edit');
    links.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const qid = a.getAttribute('data-qid');
        if (qid) renderActiveQA(session, qid);
      });
    });
  }

  async function finalizeFlow(session) {
    showScoreBar(true);
    updateScoreBar(session, {});
    appEl().innerHTML =
      '<div class="card spinner-card">' +
      '<div class="spinner" aria-hidden="true"></div>' +
      '<div class="card-h" style="font-size:20px">Finalizing your review...</div>' +
      '<div class="card-sub" style="margin-top:8px">Locking in your scores</div>' +
      '</div>';

    let res;
    try {
      res = await postAction('finalize', {});
    } catch (err) {
      renderError({ title: 'Could not finalize', message: 'We could not lock in your review. Please try again.' });
      return;
    }
    if (!res.ok) {
      renderError({
        title: 'Could not finalize',
        message: (res.body && res.body.error) || 'Please try again in a moment.',
      });
      return;
    }
    renderScorecard(res.body.session_state);
  }

  function renderScorecard(session) {
    if (!session) {
      renderError({ title: 'Scorecard unavailable', message: 'We could not load your final scores. Please reload the page.' });
      return;
    }
    showScoreBar(true);
    updateScoreBar(session, { finalLocked: true });

    const composite = Number(session.human_conception_strength) || 0;
    const band = bandFor(composite);
    const cats = session.categories || {};

    const catGrid = CATEGORY_KEYS.map((cat) => {
      const num = Number(cats[cat]) || 0;
      const pillar = PILLAR_BY_CATEGORY[cat];
      return (
        '<div class="scorecard-cat">' +
        '<div class="scorecard-cat-label">Pillar ' + pillar.num + ' &middot; ' + escapeHtml(pillar.label) + '</div>' +
        '<div class="scorecard-cat-num">' + num + '</div>' +
        '<div class="scorecard-cat-bar"><div class="scorecard-cat-bar-fill" style="width:' + Math.max(0, Math.min(100, num)) + '%"></div></div>' +
        '</div>'
      );
    }).join('');

    const allAnswersHtml = (session.questions_asked || []).map((qid, idx) => {
      const question = lookupQuestion(session, qid);
      const ans = (session.answers || []).find((a) => a.question_id === qid);
      const pillar = question ? pillarFor(question.category) : { num: 0, label: '' };
      return (
        '<div class="review-item" style="margin-bottom:10px">' +
        '<div class="review-item-body">' +
        '<div class="review-item-eyebrow">Pillar ' + pillar.num + ' &middot; Q' + (idx + 1) + '</div>' +
        '<div class="review-item-q">' + escapeHtml(question ? question.text : '') + '</div>' +
        '<div class="review-item-a">' + escapeHtml(ans ? ans.answer_text : '') + '</div>' +
        '</div>' +
        '</div>'
      );
    }).join('');

    appEl().innerHTML =
      '<div class="scorecard-hero">' +
      '<div class="scorecard-eyebrow">Final score &middot; Locked</div>' +
      '<div class="scorecard-h">Your Interactive Code Review is complete</div>' +
      '<div class="scorecard-ring band-' + band.key + '">' + composite + '</div>' +
      '<div class="scorecard-band">Human Conception Strength &middot; ' + escapeHtml(band.label) + '</div>' +
      '<div class="scorecard-msg">Composite score ' + composite + ' / 100 means ' + escapeHtml(band.message) + '</div>' +
      '</div>' +
      '<div class="card">' +
      '<div class="card-h" style="font-size:20px">Per-pillar breakdown</div>' +
      '<div class="scorecard-grid">' + catGrid + '</div>' +
      '<div class="scorecard-action-row">' +
      '<button class="btn btn-primary" id="downloadPdf" disabled title="Coming soon — generated when documents launch in a future release">Download PDF report</button>' +
      '<button class="btn btn-secondary" id="viewAllAnswers">View all answers</button>' +
      '<span class="scorecard-tooltip">PDF coming soon</span>' +
      '</div>' +
      '<div class="scorecard-all-answers" id="allAnswers">' + allAnswersHtml + '</div>' +
      '</div>';

    const viewAll = document.getElementById('viewAllAnswers');
    const allWrap = document.getElementById('allAnswers');
    if (viewAll && allWrap) {
      viewAll.addEventListener('click', () => {
        allWrap.classList.toggle('shown');
        viewAll.textContent = allWrap.classList.contains('shown') ? 'Hide all answers' : 'View all answers';
      });
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  function lookupQuestion(session, questionId) {
    const remaining = session.questions_remaining || [];
    const fromRemaining = remaining.find((q) => q.id === questionId);
    if (fromRemaining) return fromRemaining;
    // Fall back to category derivation from id naming convention
    // (q_<category>_<n>) when the question is no longer in the
    // remaining list (e.g. it was already answered).
    const catMatch = /^q_([a-z_]+?)(?:_\d+)?$/.exec(questionId || '');
    const category = catMatch && PILLAR_BY_CATEGORY[catMatch[1]] ? catMatch[1] : 'problem_framing';
    return { id: questionId, category: category, text: '', hint: '' };
  }

  function findPreviousAnswerText(session, questionId) {
    const ans = (session.answers || []).find((a) => a.question_id === questionId);
    return ans ? ans.answer_text || '' : '';
  }

  function lastAnswerTs(session) {
    const answers = session.answers || [];
    if (answers.length === 0) return null;
    return answers[answers.length - 1].ts || null;
  }

  function pillarFor(category) {
    return PILLAR_BY_CATEGORY[category] || { num: 0, label: category || '' };
  }

  function pillarLabel(category) {
    const p = pillarFor(category);
    return 'Pillar ' + p.num + ' · ' + p.label;
  }

  function bandFor(composite) {
    if (composite >= 90) return { key: 'file_ready', label: 'File-ready', message: 'your conception story is well-documented and ready for filing.' };
    if (composite >= 70) return { key: 'close_to_ready', label: 'Close to ready', message: 'you have a strong record; a few targeted improvements will get you to file-ready.' };
    if (composite >= 40) return { key: 'building', label: 'Building strength', message: 'you have a foundation; more specific evidence will strengthen your position.' };
    return { key: 'not_ready', label: 'Not yet ready', message: 'add concrete details and evidence before filing.' };
  }

  function truncate(text, max) {
    const s = String(text || '');
    if (s.length <= max) return s;
    return s.slice(0, max).trimEnd() + '...';
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (err) {
      return '';
    }
  }

  function formatRelative(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const diffMs = Date.now() - d.getTime();
      const min = Math.round(diffMs / 60000);
      if (min < 1) return 'just now';
      if (min < 60) return min + ' min ago';
      const hr = Math.round(min / 60);
      if (hr < 24) return hr + ' hr ago';
      const day = Math.round(hr / 24);
      if (day < 30) return day + ' day' + (day === 1 ? '' : 's') + ' ago';
      return formatDate(iso);
    } catch (err) {
      return '';
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
