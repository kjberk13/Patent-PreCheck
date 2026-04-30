Phase 2.7 Commit 3 — PR-A1 — Q&A Frontend Flow

File: phase-2.7-commit-3-pr-a1-brief.md (at repo root) Branch: feat/code-review-qa-frontend Base: main (current HEAD: 327a27b, the Bucket 2 merge commit)

Background

Phase 2.7 Commit 2 shipped the backend for the Interactive Code Review (review-signup Lambda, review-session Lambda, session_engine.js, schema migration 004). Bucket 2 normalized chrome and improved billing UX. Both are in production at 327a27b on main.

Commit 3 is the user-facing Q&A flow on top of the backend. Because Commit 3's full scope is large (Q&A page + evidence upload + two-document generation), it's split across three sequential PRs:

PR-A1 (this brief): Q&A frontend flow — new /review.html page, welcome-back resume, sticky score bar, single-page question flow, finalize, scorecard, plus access-link email and analyze.html sessionStorage write.
PR-A2 (later): Evidence upload — per-question evidence affordance, Netlify Blobs storage, engine adapter passes evidence metadata for boost scoring.
PR-A3 (later): Document generation — DOCX working draft + PDF filing-ready document, both patent-filing-structured, both with embedded evidence; second email with download links.
After all three, two follow-up PRs ship independently:

PR-B: Missing-input-flow fix — mini paste textarea on /review-signup.html when input_hash isn't in sessionStorage.
PR-C: Free-score lead capture — email-capture card on /analyze.html for free-tier users.
This brief covers PR-A1 only.

Scope summary

Five components in PR-A1:

Component A — analyze.html sessionStorage write. Producer side of patent-precheck-review-input. When user clicks the upgrade CTA on /analyze.html, before navigation, compute SHA-256 of their pasted code/text and write {hash, length} to sessionStorage under the existing key.
Component B — New /review.html page. Single-page Q&A flow with sticky score bar, welcome-back resume, free-text answer field, server-driven question progression, locked-feedback display, user-finalize review screen, final scorecard.
Component C — Resend email integration. After successful signup (existing review-signup Lambda), fire-and-forget email to user with their /review.html?id=... link. No new email types beyond this access-link email in PR-A1.
Component D — localStorage convenience layer. When user finalizes signup, write report_id to localStorage so that subsequent visits to /review.html (with no ?id= param) auto-populate from local state.
Component E — Privacy policy + terms updates. Initial paid-tier data-handling section in /privacy.html and /terms.html covering: answers stored, scores stored, 30-day active window, deletion timeline, what's retained permanently. Evidence and document generation language deferred to PR-A2 and PR-A3 respectively.
Component A — analyze.html sessionStorage write

Background

The review-signup.js shim already reads patent-precheck-review-input from sessionStorage to populate input_hash and input_length in the signup payload. Today, no page writes to this key — we manually planted it during smoke testing. PR-A1 fixes the producer side.

What to do

In apps/website/analyze.html (and the corresponding handoff/01-website/analyze.html mirror), modify the upgrade CTA click handler.

Currently the handler at the bottom of analyze.html's inline script reads:


javascript
const upgradeBtn = $('upgradeToReviewBtn');
if (upgradeBtn) {
  upgradeBtn.addEventListener('click', () => {
    const params = new URLSearchParams(window.location.search);
    const access = params.get('access');
    const target = access
      ? '/review-signup.html?access=' + encodeURIComponent(access)
      : '/review-signup.html';
    window.location.href = target;
  });
}
Replace with logic that:

Verifies content (the global variable holding the user's pasted code or uploaded file content) is non-empty
Computes SHA-256 hash of content using the SubtleCrypto API
Writes {hash: <hex_string>, length: <integer>} to sessionStorage under patent-precheck-review-input
Then navigates to /review-signup.html (preserving ?access= as before)
If content is empty (somehow user got to upgrade button without analyzing), DON'T write to sessionStorage. Just navigate. The signup form will then show the "Your invention details aren't on file yet" error — which PR-B addresses, but is the correct behavior for now.

SHA-256 implementation

Use SubtleCrypto for cryptographic hashing — built into the browser, no library needed:


javascript
async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
Wrap the click handler as async to await the hash computation. If hashing fails (extremely rare, could happen on insecure-context HTTP — but Netlify is HTTPS so this is theoretical), fall back to navigation without writing sessionStorage.

Mirror

Update handoff/01-website/analyze.html to be byte-identical.

Tests

No automated tests for this component. Manual verification: open /analyze.html, paste any code, click "Get my free score," wait for results, click upgrade CTA, on /review-signup.html open DevTools console and confirm sessionStorage.getItem('patent-precheck-review-input') returns a JSON string with valid hash (64-character hex) and length

Component B — New /review.html page

This is the bulk of the PR. The Q&A interface itself.

File location

Create new files:

apps/website/review.html — the page
apps/website/js/review.js — the JS module
Mirror both to handoff/01-website/review.html and handoff/01-website/js/review.js
URL contract

The page is loaded as /review.html?id=PPC-2026-04-26-XXXXX where the id parameter is a report_id from a code_review_signups row.

If ?id= is missing:

Check localStorage.getItem('patent-precheck-active-review') — if present and non-empty, redirect to /review.html?id=<that_value> (auto-resume)
If localStorage is empty, redirect to /analyze.html (user belongs there to start a free analysis first)
If ?id= is present but the report_id doesn't exist or doesn't match the user (covered in future PR with auth), the page calls the status action which will return an error; the page renders an error state asking user to check their email for the correct link.

Page chrome

Same canonical nav and footer pattern as the rest of the site (per Bucket 2 normalization). Reference nav.js for runtime replacement. Logo, links, and footer should match analyze.html / review-signup.html exactly. Same fixed-position nav (68px height, semi-transparent background with backdrop-filter blur).

Page states

The page renders one of these states based on the result of calling the status action of the review-session Lambda:

Loading state — initial render, shown while the status call is in flight
Welcome-back state — session exists, in-progress, returning user
Active Q&A state — current question being answered, score bar live
Review state — all questions answered, user reviewing answers before finalize
Finalizing state — user clicked finalize, waiting on Lambda response
Final scorecard state — session is locked, finalized
Error state — session not found, expired, or other Lambda error
State transitions:


Loading
  → status: not_started → call start action → Active Q&A (question 1)
  → status: in_progress → Welcome-back (with Continue button) → Active Q&A
  → status: ready_to_finalize → Welcome-back (alternate copy) → Review
  → status: finalized → Final scorecard
  → status: error or 404 → Error state

Active Q&A
  → submit answer → Active Q&A (next question)
  → submit answer with no next_question → Review
  → user navigates back → Active Q&A (previous question)

Review
  → user clicks "Edit" on an answer → Active Q&A (that question, with current answer pre-filled)
  → user clicks "Finalize my review" → Finalizing
  → user clicks "Back to last question" → Active Q&A (last question)

Finalizing
  → Final scorecard (success) or Error state (failure with retry)

Final scorecard
  → terminal — user can navigate away or close tab
Sticky score bar

A fixed-position bar at the top of the content area (below nav, sticky to top of viewport when user scrolls). Visible in all states except Loading and Error.

Background: navy #0C2340 to match site's dark sections.

Contents (left to right, top row):

Composite Human Conception Strength — large number (28px), label "Human Conception Strength" above (10px uppercase rgba(255,255,255,0.5)), with /100 indicator and delta indicator that flashes "+N" in green when score increases after answer submission
No question count — per locked design decision
Bottom row (4-column grid, equal width):

Problem framing — label, score number, progress bar
Constraints — label, score number, progress bar
Conception moment — label, score number, progress bar
Decision record — label, score number, progress bar
Each category cell:

Label: 10px uppercase, rgba(255,255,255,0.6)
Score: 13px medium-weight, color #85B7EB when >0, rgba(255,255,255,0.5) when 0
Bar: 4px tall, rgba(255,255,255,0.08) background, #85B7EB fill, width = score%
On mobile (< 760px), the four-category grid collapses to 2x2. On very narrow screens (< 480px), categories can collapse to 1x4 stacked or hide entirely with composite remaining.

When an answer is submitted and the engine returns a non-zero delta:

Composite delta indicator appears showing "+N" in #4DD9A8 (green), opacity 1
Composite number animates from old to new value (CSS transition)
Affected category bar fills to new width with 400ms ease transition
Affected category number updates
After ~1.5 seconds, delta indicator fades out (opacity 0) but stays in DOM
Welcome-back state

Shown when status returns in_progress (session exists, has answered at least 1 question, not finalized, not expired).

Content:


[Sticky score bar shows current state — composite + categories]

[Card]
Eyebrow: WELCOME BACK, [FIRST_NAME]
Heading: You're 3 questions in
Subheading: Last activity: yesterday at 4:42 PM · Session expires May 27, 2026

[Up next box, blue-tinted]
PILLAR 2 · Section 102 NOVELTY
What sources did you research before building this?

[Two buttons side by side]
[Continue where you left off]   [Review past answers]
The "Continue" button transitions to Active Q&A state at the next-question (returned by status action). The "Review past answers" button transitions to a Review state but with no Finalize button (because answers aren't all in yet) — just listing answered questions with Edit links.

If status returns ready_to_finalize (all questions answered but not finalized), the welcome-back screen instead says:


Eyebrow: WELCOME BACK, [FIRST_NAME]
Heading: Ready to finalize your review
Subheading: All questions answered. Your scores are locked in unless you finalize.

[Primary button]
[Review and finalize]
This goes directly to the Review state.

Active Q&A state

The main interaction state. Sticky score bar at top, then the question card below.

Question card structure:


[Question eyebrow]
Pillar X · category_label

[Question text]
Larger, primary color, weight 500

[Hint text]
Smaller, secondary color, italics

[Answer textarea]
Full width, min-height 100px, resizable

[Feedback area — initially hidden]
Background: var(--color-background-success)
Border-left: 3px solid var(--color-text-success)
Padding: 12px 14px
Hidden until after submit

[Footer row — left and right]
[Previous] (only shown if question_id has a previous question in `questions_asked`)
[Submit answer] (or "Finalize" if this is the last unanswered question)
When user clicks Submit answer:

Disable Submit button immediately (prevent double-submit, per the same pattern as Bucket 2 polish nit 1)
Read answer text from textarea
If answer text is empty/whitespace, show inline error "Please provide an answer" and re-enable button
POST to review-session Lambda with {action: 'answer', report_id: <id>, question_id: <current_q_id>, answer_text: <text>}
On 200 response:
Update score bar with new categories + composite (animate per Sticky score bar spec)
Show feedback message in feedback area (engine returns the message string per session_engine.js feedback patterns)
After ~1.2 seconds, transition to next question (or to Review if no next_question)
On error response (4xx/5xx):
Re-enable button
Show inline error
Don't transition
When user clicks Previous: navigate to the previous question (use questions_asked array from session state). The previous answer is pre-populated in the textarea so user can edit. If user submits an edited answer, the engine receives a new answer action for the same question_id. Engine takes max(prev_score, new_score) per session_engine.js, so re-answering can only improve the score, not reduce it. 

Review state

Shown when all questions are answered and user reaches the finalize step (or comes back via welcome-back to a ready_to_finalize session).

Content:


[Sticky score bar shows final pre-finalize state]

[Card]
Heading: Review your answers before finalizing
Subheading: You can edit any answer. After finalizing, your scores are locked and a dated PDF is generated.

[List of answered questions, each as a small card]
Per question:
  Eyebrow: PILLAR X · QY
  Question text (smaller, secondary color)
  Answer text (truncated to 200 chars with "..." if longer)
  Right-aligned: Edit link (transitions to Active Q&A state at that question)

If session has more than 5 answered questions, only show first 4 + "+ N more answers · View all" expandable

[Confirmation banner]
Background: info-tinted
"Heads up: Once you finalize, scores lock in and your final report will be generated. You can still re-run analysis on a new project anytime."

[Footer row]
[Back to last question]   [Finalize my review]
Edit link from any answer transitions back to Active Q&A state, with the answer pre-populated. After re-answering, user is returned to Review (not the next question, since they're past Q&A).

Finalize button transitions to Finalizing state.

Finalizing state

Shown briefly while the finalize action call is in flight.

Content:


[Centered card]
[Spinner — 40px, navy track with green leading edge, 0.8s spin]
Heading: Finalizing your review...
Subheading: Locking in your scores
After Lambda response, transitions to Final scorecard (success) or Error state (failure).

PR-A1 Note: PR-A3 will replace this with a multi-step progress display ("Generating working draft... Generating filing-ready version... Sending email..."). For PR-A1, just lock the session and show the scorecard.

Final scorecard state

Shown when session is finalized.

Content:


[Sticky score bar shows final state, possibly with a "FINAL" tag or similar to indicate locked]

[Hero card, navy background]
Eyebrow: FINAL SCORE · LOCKED
Heading (large, serif): Your Interactive Code Review is complete

[Composite display, centered]
Big circular score ring, 80px diameter
Number: composite Human Conception Strength
Border color: based on band (band-not_ready / band-building / band-close_to_ready / band-file_ready, same as analyze.html bands)
Below: "Human Conception Strength · {Band Label}"

[Categories grid, 2x2]
Per category:
  Label: 12px uppercase
  Score: 24px serif weight 700
  Bar: 4px progress bar with band coloring

[Subtitle]
Composite score X / 100 means [Band-specific message about what this score level means]

[Action row]
[Download PDF report] (PR-A3 will wire this; PR-A1 shows a "Coming soon" tooltip on hover)
[View all answers]
The "View all answers" button reveals an expanded section showing every Q&A pair below the scorecard.

Engine adapter (review-session Lambda)

The review-session.js Lambda already exists from Commit 2 with four actions: start, answer, finalize, status. PR-A1 must verify it works correctly with the new frontend. Specifically, confirm that:

start returns the first question (the engine's pickInitialQuestions() returns up to 4 questions; start should return question[0] and not advance the state)
answer returns updated session_state, delta, feedback string, and next_question
finalize locks the session and returns the final session_state
status returns the current session_state without modification, plus a state field indicating what the frontend should render (not_started / in_progress / ready_to_finalize / finalized / expired)
If any of these contracts aren't currently met by the shipped Lambda, this PR includes the necessary Lambda updates as part of its scope. Verify by reading the existing review-session Lambda before starting frontend work.

Tests for Component B

Manual smoke tests after deploy preview is live:

Visit /review.html?id=<known_test_id> → loads, shows current state correctly
Visit /review.html with no params and no localStorage → redirects to /analyze.html
Visit /review.html with no params but with localStorage active-review → auto-redirects to /review.html?id=<that_id>
Submit an answer → score bar updates, feedback appears, next question appears
Click Previous → previous question loads with prior answer
Re-answer with worse content → score doesn't decrease (engine takes max)
Answer all questions → review state appears
Click Edit on a past answer → returns to Q&A for that question
Click Finalize → session locks, scorecard appears
Reload page after finalize → directly shows finalized scorecard
No automated unit tests for the page itself. The Lambda is already covered by Commit 2's test files.

Component C — Resend email integration

Provider setup

Resend account is already created. API key is set as Netlify environment variable RESEND_API_KEY.

For sender domain: until Patent PreCheck has its own configured domain in Resend, send from Resend's default onboarding@resend.dev (works for testing). Domain configuration is a follow-on task — Kevin will configure noreply@patentprecheck.com later.

What to send

After a successful insert in the existing review-signup.js Lambda (after the database row is created and report_id is generated), fire an email with these contents.

Subject: Your Interactive Code Review is ready — Patent PreCheck

Body should be a simple HTML email that's mobile-friendly. Include:

Logo header
H1: "Your Interactive Code Review is ready"
Body paragraph greeting the user by first name and explaining they can come back anytime within 30 days
A primary CTA button "Start your review" linking to https://patentprecheck-1776362495343.netlify.app/review.html?id={report_id}
A second body paragraph noting the session is active until {finalized_at + 30 days} and that the final filing-ready document is generated when finalized
Sign-off: "The Patent PreCheck team"
Footer with the Patent PreCheck name and an unsubscribe/preferences link
PR-A1 Note: keep email simple. Detailed branding, custom HTML email components, and brand polish can iterate post-PR. The functional requirement is: deliver a clickable link to the user's email address.

Implementation

Add a new file: apps/backend/lib/email_sender.js exporting:


javascript
async function sendAccessLinkEmail({to, firstName, reportId, sessionEndDate}) {
  // Returns Promise resolving to {success: true, messageId} or {success: false, error}
  // Fire-and-forget at call site; errors are logged but don't fail signup
}
In review-signup.js Lambda, after INSERT INTO code_review_signups succeeds and we have report_id:


javascript
// Fire-and-forget — don't await, don't throw on failure
sendAccessLinkEmail({
  to: signup.email,
  firstName: signup.first_name,
  reportId,
  sessionEndDate: <calculated_date>,
}).catch(err => console.error('Email send failed (non-fatal):', err.message));
Email failure must NOT fail the signup. The user is already on the success page; the email is for re-entry. If Resend is down, log the error and continue.

Resend integration code

Use the Resend Node.js SDK. Run npm install resend to add it.


javascript
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendAccessLinkEmail({to, firstName, reportId, sessionEndDate}) {
  const reviewUrl = `${process.env.SITE_URL || 'https://patentprecheck-1776362495343.netlify.app'}/review.html?id=${reportId}`;
  
  try {
    const result = await resend.emails.send({
      from: 'Patent PreCheck <onboarding@resend.dev>',
      to: [to],
      subject: 'Your Interactive Code Review is ready — Patent PreCheck',
      html: renderEmailHtml({firstName, reviewUrl, sessionEndDate}),
    });
    return {success: true, messageId: result.data?.id};
  } catch (err) {
    return {success: false, error: err.message};
  }
}
The renderEmailHtml helper produces a simple HTML email template. Minimal styling — inline styles only (most email clients strip <style> tags). Keep under 200 lines.

Tests for Component C

Add apps/backend/tests/email_sender.test.js with tests for:

Calling sendAccessLinkEmail with valid inputs returns success
Calling with malformed email returns error (Resend rejects)
Calling without RESEND_API_KEY env var returns error gracefully (don't crash)
These tests use a stubbed Resend client (don't actually call the API in tests). Mock the Resend constructor.

For the integration test in review-signup.test.js, add a new test verifying that sendAccessLinkEmail is called after successful signup (use a stub).

Component D — localStorage convenience layer

What to do

After a successful signup in the existing review-signup form's success handler:

Currently the form does window.location.href = response.redirect_url (which is /analyze.html?review=<report_id>)
Update this to first write localStorage.setItem('patent-precheck-active-review', report_id)
Then redirect to /review.html?id=<report_id> (changed from /analyze.html?review=<report_id>)
Also update the review-signup Lambda's response to use the new URL. The Lambda currently returns redirect_url: '/analyze.html?review=...'. Change to redirect_url: '/review.html?id=...'. This requires a small Lambda update.

On the new /review.html page:

If ?id=<report_id> is present in URL → use it directly
If not present → check localStorage.getItem('patent-precheck-active-review') → if present, redirect to /review.html?id=<that_value> (auto-resume)
If neither → redirect to /analyze.html
After a session is finalized, leave the localStorage entry alone — finalized sessions are still valid bookmarks; user might want to revisit. But after the 30-day expiration (or 14-day post-finalize buffer in PR-A3), localStorage cleanup happens lazily: when /review.html loads with that id and the Lambda returns "expired," the page can clear localStorage on the way to its error state.

Tests for Component D

Manual:

Complete signup → verify localStorage has patent-precheck-active-review set to the report_id
Visit /review.html with no params → auto-redirects to /review.html?id=<that_value>
Clear localStorage → visit /review.html with no params → redirects to /analyze.html
Component E — Privacy policy + terms updates

This is the legal compliance work for PR-A1. The current /privacy.html and /terms.html were written for the free-tier flow. PR-A1 introduces persistent storage of paid-tier session content (answers + scores), so the policy must explicitly cover this.

Privacy policy update

Edit apps/website/privacy.html (and handoff mirror). Add a new section after the existing "How we use your information" section. The new section should be titled "Interactive Code Review — Paid Tier Data Handling" and explain:

This applies to the paid Interactive Code Review, separate from the free Patent PreCheck Score where code is never stored
What's stored during a paid session: answers to interview questions, scores, session metadata
Note that evidence file uploads and final document generation are not yet part of paid sessions; policy will be updated when those features launch
Retention: 30-day active window, then answer text deleted; scores and customer record retained
What's kept permanently: contact info, report ID and completion timestamp, aggregate scores
Encryption: stored encrypted at rest in Neon Postgres, transmitted over HTTPS
Vendor disclosure: Resend for email, Anthropic for AI scoring, Netlify for hosting
Terms of service update

Edit apps/website/terms.html (and handoff mirror). Add a new section after the existing "Use of the Service" section titled "Interactive Code Review Sessions" covering:

The Interactive Code Review is a one-time service with a 30-day active Session Window starting at purchase
Within the Session Window, user can answer questions, resume from email link, finalize to lock scores
After Session Window ends, session content is deleted but scores and completion status retained
Non-refundable except for significant service unavailability
Patent PreCheck is not a law firm and does not provide legal advice
Trust banner on /review.html

Add a small trust banner somewhere on /review.html (perhaps as a collapsed/expandable element under the score bar, or as a footnote at the bottom) with text like:

"Your answers and scores are stored securely for your 30-day session window and are deleted afterward. See our privacy policy for details."

Link to /privacy.html.

Schema

PR-A1 doesn't require schema changes. The existing code_review_signups table from migration 004 has the columns needed (report_id, session_state JSONB, finalized_at, all customer fields).

PR-A3 will add columns for document storage. PR-A2 will use the existing code_review_evidence table.

Workflow

Create branch feat/code-review-qa-frontend from main (current HEAD: 327a27b)
Land this brief at phase-2.7-commit-3-pr-a1-brief.md as the first commit
Component A: analyze.html sessionStorage write
Component B: New /review.html page (this is the largest piece — break into sub-commits if helpful: page skeleton, sticky score bar, Q&A state, welcome-back state, review state, finalize state, scorecard state)
Component C: Resend integration in email_sender.js + review-signup.js Lambda integration
Component D: localStorage convenience layer + Lambda redirect_url update
Component E: Privacy + terms updates + trust banner
Run tests + lint + format checks
Push, open PR, request review
Required tests

Run npm run test — all existing tests must still pass; new email_sender.test.js must pass
Run npm run lint — clean
Run npm run format:check — clean (no new pre-existing warnings)
Before pushing, verify locally:

/analyze.html upgrade CTA writes sessionStorage correctly (open DevTools, check after click)
/review-signup.html form submission redirects to /review.html?id=...
/review.html?id=<test_id> loads correctly
Resend email is received in your inbox after a test signup
What is OUT of scope

Evidence upload UI — PR-A2
Document generation (DOCX, PDF) — PR-A3
Final document email (separate from access-link email) — PR-A3
Reminder emails — future PR
Background cleanup job for expired sessions — PR-A3
Missing-input-flow fix — PR-B
Free-tier email lead capture — PR-C
Schema changes — none in PR-A1
Authentication / session ownership check — explicitly deferred to a future hardening PR
Account creation, login, password management — explicitly out of scope
Done criteria

All five components shipped and verified
/review.html renders correctly in all seven states
Resend integration works (email delivered to test inbox after signup)
Privacy policy and terms updated
Existing tests pass; new email_sender.test.js passes; lint clean; format clean
Handoff mirrors are byte-identical to source
Manual smoke test of end-to-end flow passes:
Run free analysis on /analyze.html
Click upgrade CTA → /review-signup.html with sessionStorage populated
Fill signup form → submit → redirected to /review.html?id=...
Receive email with link to same URL
Submit answers, see scores update live, see feedback messages
Reach review state, finalize, see scorecard
Reload page → see finalized scorecard directly
When ready, push and open a PR. Reply with the PR URL when done.






