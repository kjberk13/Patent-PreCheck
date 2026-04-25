# Phase 2.7 — Interactive Code Review Build Brief

**For:** Claude Code
**Prepared by:** Kevin + Claude (planning)
**Estimated scope:** 5-7 days, broken into 4 reviewable commits

---

## Context

Phase 2.6 is complete. Patent PreCheck has a working free-tier engine against 16,030 prior art documents in Neon, homepage flagship section shipped, and ™ branding treatment live across the site.

Phase 2.7 is the paid tier: **Interactive Code Review at $69.95**. This is NOT a simple PDF generator — it's a guided, multi-turn experience that walks users through refining their invention documentation while live-updating their score. Output is an attorney-ready invention disclosure document.

Before you start, read `PROJECT_STATE.md` at the repo root, then read these scoped files (all of them — they're each small):
- `ENGINE_STATE.md` — scoring methodology, evidence categories, color-band rules
- `FEATURES_STATE.md` — Interactive Code Review UX spec, evidence upload capability, dual-output deliverables
- `DESIGN.md` — color tokens, typography, components, animation, copy patterns
- `OPEN_QUESTIONS.md` — what's resolved vs. what's still open
- `PRIVACY_TERMS.md` — privacy policy and terms framework
- `INFRA_STATE.md` — env vars and schema you'll be touching

---

## Goal

Ship the complete Interactive Code Review feature with a beta-bypass URL so Kevin can test end-to-end before wiring Stripe. All infrastructure in place for paid launch except the actual payment gate.

---

## Commit Plan

Break the work into 4 review branches, each FF-merged to `main` after Kevin's approval:

**Commit 1 — Rename, reprice, new signup page skeleton**
**Commit 2 — Backend session engine + bypass token + schema**
**Commit 3 — Frontend interactive Q&A experience**
**Commit 4 — PDF generation + email delivery + privacy/terms updates**

Push each branch separately. Kevin will FF-merge in sequence.

---

## Commit 1 — Rename, Reprice, Signup Page Skeleton

### Rename site-wide

Search `apps/website/` and `handoff/01-website/` for "Full Report" and replace with "Interactive Code Review". Mirror all changes between the two directories.

### Reprice site-wide

Search for "$69.99" and replace with "$69.95". Same mirroring between the two directories.

### New page — `/review-signup.html`

Create a new HTML page at `apps/website/review-signup.html` (mirror to `handoff/01-website/review-signup.html`).

**Structure (static only for this commit — no backend yet):**
- Header: uses shared `nav.js`
- Hero: "Complete your Interactive Code Review setup"
- Subhead: "A few details help us personalize your report and protect your invention."
- Form with 6 required fields (see "Signup Form" below)
- Footer: uses shared `nav.js`

**Signup form (6 REQUIRED fields + 1 optional — six mandatory per FEATURES_STATE.md):**
1. First name (text input, required)
2. Last name (text input, required)
3. Business name (if applicable) — non-required text input, `name="business_name"`, `autocomplete="organization"`
4. Email (email input, required, validated format)
5. Phone (tel input, required, US format validation with international fallback)
6. Address (4 sub-fields: Line 1, Line 2 [optional], City, State, Zip; country always US for MVP via hidden input)
7. Billing address — with "Billing address is the same as my address" checkbox (default checked) that hides billing fields; if unchecked, same sub-fields plus hidden `billing_country=US`

**Form submission:**
- For this commit: `<form>` posts to a placeholder endpoint that returns 501 Not Implemented
- Next commit wires the actual backend
- Include client-side validation (HTML5 + small JS) for required fields, email format, phone format
- Show clear error messages inline, not in alert()

**Styling:**
- Use existing design system from `DESIGN.md` (navy, blue, green, Playfair Display headlines, DM Sans body)
- Match `analyze.html` visual vocabulary
- Mobile-responsive (768px and 480px breakpoints)### Update `/analyze.html` — add upgrade CTA to results

When free-tier analysis completes and scores render, add a new block below the results:

**Upgrade CTA block:**
- Heading: "Ready for the full Interactive Code Review?"
- 3 bullets describing what's different:
  - "Deeper, personalized analysis with live score refinement"
  - "Attorney-ready invention disclosure document"
  - "PDF report emailed to you + 30-day web access"
- Price: "$69.95 — one-time"
- CTA button: "Upgrade to Interactive Code Review →"
- Button action: preserves any `?access=` URL parameter and navigates to `/review-signup.html?access={preserved_value}` (or no param if none present)

---

## Commit 2 — Backend Session Engine + Bypass Token + Schema

### Migration `004_code_review_signups.sql`

Create in `infra/migrations/` with the following content:

```sql
CREATE TABLE code_review_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  business_name TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  address_city TEXT NOT NULL,
  address_state TEXT NOT NULL,
  address_zip TEXT NOT NULL,
  address_country TEXT NOT NULL DEFAULT 'US',
  billing_same_as_address BOOLEAN NOT NULL DEFAULT FALSE,
  billing_line1 TEXT,
  billing_line2 TEXT,
  billing_city TEXT,
  billing_state TEXT,
  billing_zip TEXT,
  billing_country TEXT DEFAULT 'US',
  access_method TEXT NOT NULL CHECK (access_method IN ('beta_bypass', 'stripe_payment')),
  access_token_used TEXT,
  input_hash TEXT NOT NULL,
  input_length INTEGER NOT NULL,
  report_id TEXT NOT NULL UNIQUE,
  idf_pdf_url TEXT,
  application_pdf_url TEXT,
  session_state JSONB,
  session_completed_at TIMESTAMPTZ,
  created_ip TEXT,
  user_agent TEXT
);

CREATE INDEX idx_code_review_signups_email ON code_review_signups(email);
CREATE INDEX idx_code_review_signups_created_at ON code_review_signups(created_at DESC);
CREATE INDEX idx_code_review_signups_report_id ON code_review_signups(report_id);

-- Evidence upload metadata table (per FEATURES_STATE.md ("Evidence upload capability" subsection))
-- NOTE: We never store original files per PRIVACY_TERMS.md Option C policy. This table stores
-- ONLY metadata and Claude-extracted structured evidence, never file contents.
CREATE TABLE code_review_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id UUID NOT NULL REFERENCES code_review_signups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size_bytes INTEGER,
  upload_timestamp TIMESTAMPTZ NOT NULL,
  claimed_document_date DATE,
  user_description TEXT,
  category TEXT NOT NULL CHECK (category IN ('problem_framing', 'constraints', 'conception_moment', 'decision_record')),
  extracted_evidence JSONB NOT NULL,
  supports_claim BOOLEAN NOT NULL,
  score_contribution INTEGER DEFAULT 0
);

CREATE INDEX idx_code_review_evidence_signup ON code_review_evidence(signup_id);
CREATE INDEX idx_code_review_evidence_category ON code_review_evidence(category);
```

**CRITICAL data rule (per FEATURES_STATE.md and PRIVACY_TERMS.md):**
- Column is `input_hash`, NOT `input_content`
- We hash the user's pasted code/invention description with SHA-256 and store ONLY the hash
- We do NOT store the raw text anywhere persistent
- Session state (which can include short summaries for engine context) goes in `session_state` JSONB — but raw user content is never preserved past the 30-day review window### Lambda function — `/.netlify/functions/review-session`

Create new Lambda at `apps/website/netlify/functions/review-session.js` (and mirror to `handoff/01-website/netlify/functions/review-session.js`).

**Handles these actions (POST body carries `action` field):**

**`start` action:**
- Input: `signup_id`, `input_hash`, `input_length`, free-tier scoring summary
- Generates a report ID (format: `PPC-YYYY-MM-DD-XXXXX`)
- Creates initial session state with the four evidence category scores (all starting at 0%)
- Runs the free-tier engine against the hashed input to pre-populate claim candidates
- Returns: `report_id`, session state, list of Q&A questions to ask next (initial batch of 3-5 based on weakest evidence categories)

**`answer` action:**
- Input: `report_id`, `question_id`, `answer_text`, optional `evidence_uploads[]`
- Runs Claude with the scoring rubric from ENGINE_STATE.md to evaluate the answer against the specific evidence category the question targets
- If evidence_uploads present: processes each (OCR images, extract text from docs, evaluate support for category) — **never persist original files**, only extracted structured evidence + metadata per FEATURES_STATE.md Evidence Upload section
- Updates the relevant category score (0-100%) per the five-tier rubric (0%, 15-25%, 40-60%, 70-85%, 100%)
- Updates composite Human Conception Strength (weighted average of 4 categories per claim, further averaged across claims by claim importance)
- Returns: updated session state, score delta, appropriate feedback message (from the live-update feedback patterns in ENGINE_STATE.md), optionally next question if this category is now saturated

**`finalize` action:**
- Input: `report_id`
- Locks the session (no more edits after finalize)
- Triggers dual PDF generation (IDF + filing-ready application)
- Triggers email delivery via Resend
- Returns: PDF URLs, email status

**`status` action:**
- Input: `report_id`
- Returns: full session state (used for reload + web view after email delivery)

### Beta bypass logic

New env var on Netlify: `BETA_ACCESS_TOKEN`

**Access control flow:**
- User signs up at `/review-signup.html?access={token}`
- Frontend passes `access` param to backend
- Backend checks: if `access === BETA_ACCESS_TOKEN` (from env), set `access_method='beta_bypass'` and proceed
- If token missing or wrong, signup completes with `access_method='stripe_payment'` but the session creation endpoint returns 402 Payment Required
- For Phase 2.7, the 402 response is handled client-side with a "Payment coming soon" message (Stripe wires in Phase 4)

**Env var guidance for Kevin:** Kevin will add `BETA_ACCESS_TOKEN` with a value of his choosing (suggest `BETA2026-PPC` or similar). Document this in INFRA_STATE.md under Netlify env vars when shipping.

### Input hashing

Client-side pre-submission: the user's input from `/analyze.html` is SHA-256 hashed on the client before sending to review-session. We receive the hash and the input length — never the raw content.

For operational debugging, the session_state JSONB can contain a short (~500 char) summary of the invention that Claude extracts during the free-tier analysis. That summary is what downstream engine calls use — not the raw user text. Per PRIVACY_TERMS.md this is acceptable because the summary is engine-generated metadata, not a verbatim copy of user content.

### Error handling

- 400 Bad Request: missing required params or malformed body
- 401 Unauthorized: signup_id doesn't match (someone else's session)
- 402 Payment Required: non-bypass access attempted
- 404 Not Found: invalid report_id
- 409 Conflict: action not valid for current session state (e.g., `answer` after `finalize`)
- 500 Internal Server Error: log and return opaque message to user (don't leak internals)

### Rate limiting

For each `signup_id`:
- Max 100 `answer` actions per 24 hours (prevents runaway gaming of scoring)
- Max 50 evidence uploads per 24 hours (prevents DDoS via file processing)
- Max 3 `finalize` actions per signup (prevents multi-generation abuse)

Implement with an in-memory Map for Phase 2.7 (Lambda state resets, but 24h windows mostly align with session flow). Note for Phase 4: move to Redis or DB-backed rate limiting.---

## Commit 3 — Frontend Interactive Q&A Experience

### New page state — `/analyze.html` extension (NOT a new page)

The interactive Q&A runs inside the existing `/analyze.html` page, loaded dynamically after the user clicks "Upgrade to Interactive Code Review" and completes the signup flow. Keep the existing analyze page as the single entry point; use dynamic rendering for the multi-step flow.

**Flow:**
1. User pastes code on `/analyze.html` → sees free-tier results
2. Clicks "Upgrade" → navigates to `/review-signup.html?access={token}` with the hash of their input passed via sessionStorage (so the signup page has the hash without re-entering the code)
3. Completes signup form → backend `start` creates session → user redirects back to `/analyze.html` with `?review={report_id}`
4. `/analyze.html` detects the `review` param, hides the free-tier UI, renders the interactive Q&A
5. User works through questions, sees scores update live
6. When user clicks "Finish Review" → backend `finalize` → user redirects to `/review-complete.html?report_id={id}`

### Interactive Q&A UI — the heart of the commit

**Layout (desktop):**
- Left pane (60% width): current question, answer textarea, evidence upload zone, "Next question" button
- Right pane (40% width): live-updating score display (see below)
- Header: Patent PreCheck™ nav, progress indicator ("Question 3 of ~8"), save-and-exit link

**Layout (mobile — <768px):**
- Single column, score display in a collapsible panel at top
- Textarea full-width
- Evidence upload below textarea
- Bottom sticky "Next question" button

**Single question display:**
- Question text as h2, with category label subtitle (e.g., "Problem Framing Evidence")
- Context hint: "Your answer strengthens this area of your documentation"
- Answer textarea (min-height 120px, auto-expanding)
- Optional evidence upload zone (drag-drop + click-to-select) — supports PDF, DOCX, TXT, MD, PNG, JPG, HEIC, code files, ZIP
- For each uploaded file: filename, size, optional "claimed document date" datepicker, optional "description" text input, "Remove" button
- **Mandatory privacy copy near upload zone (LOCKED per PRIVACY_TERMS.md):** "Keep your own copy — we don't store originals. Your files are read once to extract evidence, then discarded."
- Submit button: "Save & continue" (or "Submit answer" if no more questions queued)

**Live score display requirements (LOCKED per ENGINE_STATE.md):**

The right pane (desktop) or expandable top section (mobile) displays BOTH the composite AND the four categories simultaneously, like a credit score:

Layout (plain-text equivalent — render with proper progress bars in CSS):

- Human Conception Strength: 73% (Contributes 50% to your Patentability Score)
- Problem Framing Evidence: 85% (progress bar, 8 of 10 filled)
- Constraint Documentation: 70% (progress bar, 7 of 10 filled)
- Conception Moment Evidence: 50% (progress bar, 5 of 10 filled)
- Decision Record: 90% (progress bar, 9 of 10 filled)

**Mandatory help text (tooltip or info block) on every screen showing percentages:**

> **What these percentages mean**
>
> Under the USPTO Revised Inventorship Guidance (November 28, 2025), AI is treated as a tool and there is no required percentage for human contribution. The legal test is conception — did you form "a definite and permanent idea of the complete and operative invention"?
>
> The percentages you see represent how completely your documentation supports that conception across four evidence categories. Higher percentages mean stronger evidence if your patent is ever challenged. Lower percentages indicate gaps to strengthen — not disqualifying deficiencies.
>
> No specific score is "passing." Your goal is to build the evidentiary record examiners and courts look for.

**Color-coded bands for each category score (LOCKED per ENGINE_STATE.md):**
- Red (0-24%): "Considerable work needed in this area" — signals urgency, not failure
- Amber (25-49%): "Building"
- Blue (50-74%): "Solid — room to strengthen"
- Green (75-100%): "Strong documentation"

The COLOR is the glance-level signal. Surrounding COPY (in the "Feedback messages" section below) is where positive coaching lives. Red does NOT mean "fail" — it means "biggest opportunity."**Score update animation:**
- When score changes, number counts up/down smoothly over 300-500ms
- Progress bar fills/unfills over same duration with cubic-bezier(0.4, 0, 0.2, 1) easing
- If color band changes, color transitions smoothly
- Respect `prefers-reduced-motion: reduce` per DESIGN.md — instant update for users who prefer no animation

**Feedback messages (LOCKED per ENGINE_STATE.md):**
After each answer, show one of these (tone-matched to score delta):
- **+30% or more:** "Strong specific answer — that's the evidence examiners look for."
- **+15-29%:** "Nice refinement — that adds real evidentiary weight."
- **+5-14%:** "Every bit counts. That's a step forward."
- **0%:** "Your answer didn't change the score yet, but it adds to your documentation record. Can you add a specific example or date?"
- **Negative (rare):** Never shown — if an answer reveals an issue, the feedback is neutral and forward-looking: "Thanks for the clarification. Let's explore this dimension further in the next question."

### Question-loading engine

When the session starts, the engine uses the free-tier analysis to identify which evidence categories are weakest and prioritizes questions in that order. Question bank lives in `apps/website/data/code-review-questions.json` with this structure:

```json
{
  "questions": [
    {
      "id": "q_problem_framing_1",
      "category": "problem_framing",
      "text": "Describe the specific technical problem this invention solves. What was failing in existing approaches?",
      "hint": "Specific technical details + what prior approaches couldn't do",
      "weight": 1.0
    }
  ]
}
```

Source all questions from the `AI_Patentability_Inventor_Interview_Checklist.docx` document (Parts I-IV) in the prior project bundle. Organize by category:
- Problem Framing: 5 questions from Part I
- Constraints: derived from Part I design constraints question + 2 more
- Conception Moment: derived from Part I hypothesis/design question + 2 more
- Decision Record: 5 questions from Part II
- Per-feature questions: 4 from Part III (asked once per claim candidate detected)

Questions are asked adaptively — if a category hits 90%+ score, skip remaining questions in that category unless the user clicks "Ask me more about this area." Goal is 6-10 questions total per session, not 20+.

### Save & exit flow

At any point, user can click "Save & exit" → session state persists in Neon → user receives an email with a resume link: `/analyze.html?review={report_id}` valid for 30 days.

If they return, the page loads and restores their progress via the `status` action.

### Finalize flow

When user clicks "Finish Review" (available once 6+ questions answered):
- Confirmation modal: "Ready to generate your final report? You can still refine answers during your 30-day review window."
- On confirm: backend `finalize` action
- Loading state: "Generating your Interactive Code Review... this takes about 60 seconds."
- On success: redirect to `/review-complete.html?report_id={id}`
- On failure: display error + "Try again" button, don't lock the session

---

## Commit 4 — PDF Generation + Email Delivery + Privacy/Terms Updates

### Dual PDF generation (LOCKED per FEATURES_STATE.md)

The paid tier produces **TWO PDFs** per session: an Invention Disclosure Form (IDF) and a Filing-Ready Patent Application Draft. Both are generated by `finalize` and both carry the non-negotiable disclaimers.

**PDF 1 — Invention Disclosure Form (IDF)**
- Report ID format: `PPC-YYYY-MM-DD-XXXXX-IDF`
- Model after `AI_Patentability_Disclosure_IDF-2026-0042.docx` in the prior bundle
- 9 sections per FEATURES_STATE.md: Invention overview, Scoring summary, Human contribution documentation, Claim candidate identification, Alice Step 1/2 analysis, Prior art differentiation, AI tool disclosure statement, Evidence bundle summary (summaries only, NOT the originals), Next steps for attorney handoff
- Attorney-briefing tone — what a patent attorney reads to understand the invention

**PDF 2 — Filing-Ready Patent Application Draft**
- Report ID format: `PPC-YYYY-MM-DD-XXXXX-APP`
- Model after `SlidingPrefetchWindow_PatentSpec.docx` in the prior bundle
- 13 sections per FEATURES_STATE.md: Formal title, Cross-reference, Federally sponsored research statement, Field, Background, Summary, Drawings description, Detailed description, Draft claims (indep + dep), Abstract (150-word), Counsel notes throughout, Inventor declaration placeholder, AI tool disclosure
- Actual patent application text ready for attorney review before USPTO filing**Non-negotiable disclaimers (per FEATURES_STATE.md — must appear on every page of both PDFs):**
- "CONFIDENTIAL — ATTORNEY WORK PRODUCT"
- "DRAFT — NOT LEGAL ADVICE"
- "All claim language, specification text, and legal arguments must be reviewed and confirmed by a licensed patent attorney prior to filing."
- "Patent PreCheck is not a law firm and does not provide legal services."

This language is non-negotiable — it protects against UPL (unauthorized practice of law) risk. Include as a footer on every page (all pages of both documents), plus prominent placement on page 1.

### PDF rendering stack

Use **puppeteer-core + @sparticuz/chromium** (already standard for Netlify Lambda). Generate PDFs from HTML templates, not from scratch.

**Template structure (two templates, one per PDF type):**
- Templates live in `apps/website/templates/` as HTML+CSS
- Use Patent PreCheck brand colors and typography from DESIGN.md
- Header: Patent PreCheck™ logo + report ID + page number
- Footer: disclaimer block + generation timestamp

**Rendering tips (Netlify Lambda specific):**
- Pre-warm puppeteer by keeping Lambda warm (health-ping cron already does this for `/.netlify/functions/analyze`; add ping for `/.netlify/functions/review-session` too)
- Generate both PDFs in parallel, not sequentially (saves ~30 seconds total)
- If Lambda timeout (10s default) is insufficient, increase to 30s via `netlify.toml` function config
- If PDFs exceed Netlify's Lambda response size limit: upload to Netlify Blobs, return URL in response, attach via URL in email

**PDF styling details:**
- Letter size (8.5x11"), 1" margins
- Playfair Display for headings, DM Sans for body
- Navy (#0C2340) for headings, body text in text-primary
- Claim numbering: clean numeric, indented dependents
- Counsel notes in distinct colored boxes (amber or gray) so they stand out from filing text

**Storage:**
- Generate both PDFs in-memory in Lambda
- Upload to Netlify Blobs or similar (check latest Netlify storage options)
- Store public (but unguessable) URLs in `code_review_signups.idf_pdf_url` and `code_review_signups.application_pdf_url`
- URLs expire 30 days after creation (matches session window)

### Email delivery

Use **Resend** (simpler than SendGrid for transactional use case). Kevin adds API key as `RESEND_API_KEY` env var.

**Email template:**
- Subject: "Your Interactive Code Review is ready — {firstName}"
- From: `reports@patentprecheck.com` (or similar; Kevin confirms sending domain)
- Reply-To: `hello@patentprecheck.com`
- Body: HTML template with:
  - Greeting: "Hi {firstName},"
  - One paragraph: "Your Interactive Code Review for [invention title] is ready. Your Patentability Score is {score}/100 and Filing Readiness is {fr_score}/100."
  - PDF attached OR inline link (attach if <5MB, link otherwise)
  - Web view link: `https://patentprecheck.com/review-complete.html?report_id={id}` (valid 30 days)
  - Footer: Patent PreCheck™ branding, not-legal-advice disclaimer, unsubscribe link (even though transactional)

### New page — `/review-complete.html`

Create at `apps/website/review-complete.html` (mirror to `handoff/01-website/review-complete.html`).

**Purpose:** Landing page after user finishes review, and destination for email "web view" link.

**Structure:**
- Header: shared `nav.js`
- Hero: "Your Interactive Code Review is ready"
- Score display: two-score presentation matching analyze.html
- PDF download button (prominent)
- "Also emailed to {email}" confirmation
- "What happens next?" section — 3 steps: download → review → take to attorney
- Session still active banner (if within 30 days): "You can refine your answers and regenerate the report until {expiry_date}"
- Footer: shared `nav.js`

Fetches report data from `/.netlify/functions/review-session` with `action: 'status'` and `report_id` from URL.

### Privacy policy update (`/privacy.html`)

Update `apps/website/privacy.html` (mirror to `handoff/01-website/privacy.html`) to match PRIVACY_TERMS.md (Data We Collect through User Rights sections).

Key changes:
- Add "Data we collect (Interactive Code Review)" section listing: first name, last name, email, phone, formal address, business address, input hash (not raw content)
- Add "Data we do NOT collect" section confirming no raw code storage
- Third parties: add Resend for email, note Stripe for future payment
- Retention table per PRIVACY_TERMS.md (Retention Policy)
- User rights per PRIVACY_TERMS.md (User Rights)
- Update "Last updated" date to current date

### Terms of Use update (`/terms.html`)

Update `apps/website/terms.html` (mirror to `handoff/01-website/terms.html`) to match PRIVACY_TERMS.md (Legal Disclaimers through Termination sections).

Key additions/changes:
- Legal disclaimer language per PRIVACY_TERMS.md (Legal Disclaimers) (verbatim or substantially similar)
- User obligations per PRIVACY_TERMS.md (User Obligations)
- Our obligations including $69.95 refund policy per PRIVACY_TERMS.md (Our Obligations)
- IP ownership per PRIVACY_TERMS.md (IP Ownership)
- Dispute resolution (Arizona, Maricopa County) per PRIVACY_TERMS.md (Dispute Resolution)
- Termination per PRIVACY_TERMS.md (Termination)
- Update "Last updated" date

### Scoped state file maintenance

Per `PROJECT_STATE.md` "Scoped file maintenance" guidance, update the following scoped files to reflect what shipped:

- **`INFRA_STATE.md`** — Database Schema section: add `code_review_signups` and `code_review_evidence` tables as live (after Kevin confirms migration ran). Environment Variables section: document `BETA_ACCESS_TOKEN` and `RESEND_API_KEY`. Site Map section: add `/review-signup.html` and `/review-complete.html`.
- **`FEATURES_STATE.md`** — Backlog section: mark Phase 2.7 complete, update Phase 3 priority. Update the Interactive Code Review status from "Not yet built" to "Live."
- **`OPEN_QUESTIONS.md`** — resolve any pending questions that are now answered. Add a new "Resolved 2026-XX-XX" entry for the Interactive Code Review go-live decisions.
- **`PRIVACY_TERMS.md`** — only update if any privacy/terms decisions changed during the build (e.g., a different email provider than Resend). Otherwise the privacy/terms HTML updates Claude Code makes during Commit 4 should match this file as it stands.

Each scoped file gets touched only by the PR that changes its content. Do NOT update files that aren't affected.

---

## Out of Scope for This PR

**Explicitly deferred:**
- Stripe integration and actual payment processing (replaces beta bypass in Phase 4)
- User accounts / login (each Interactive Code Review is one-off; no account system yet)
- Admin dashboard for managing beta codes (Kevin uses the one `BETA_ACCESS_TOKEN` env var for now)
- Rejection pattern analysis engine (Phase 3)
- Legal intelligence pipeline / Federal Register ingestion (Phase 3)
- arXiv backfill (separate 45-min operator task, Kevin will do it independently)
- IDE plugin and Chrome extension integration (those are separate products in the ecosystem)

---

## Testing Expectations

For each commit:
- `npm run lint` clean
- `npm run test` passes
- `npm run format:check` passes
- Manual smoke test: complete the full flow end-to-end with the BETA_ACCESS_TOKEN

For commit 4 specifically:
- Verify PDF renders correctly (render in browser first, then PDF)
- Verify email delivers to a test address
- Verify all 6 signup fields save correctly to Neon
- Verify hash storage (not raw content) by inspecting the DB row directly

---

## Operator Steps After Each Commit

**Commit 1:** Kevin visits `/review-signup.html?access=TEST` and visually verifies the form layout + rename/reprice changes.

**Commit 2:** 
- Kevin runs `infra/migrations/004_code_review_signups.sql` against Neon manually
- Kevin adds `BETA_ACCESS_TOKEN` env var in Netlify (value to be determined — suggest in your PR)
- Kevin tests the endpoint with a curl or form submission to confirm bypass works

**Commit 3:** Kevin runs a full Q&A session with a test invention, verifies score updates, verifies tone feels right.

**Commit 4:**
- Kevin signs up for Resend, adds `RESEND_API_KEY` env var
- Kevin confirms sending domain (either uses their default or sets up DNS on patentprecheck.com)
- Kevin runs end-to-end test: full Q&A → finalize → receives PDF email → verifies PDF renders correctly

---

## Success Criteria

Kevin can share a URL like `https://patentprecheck-1776362495343.netlify.app/analyze.html?access=BETA2026-PPC` with a beta tester, and that tester:
1. Pastes code / invention description
2. Sees free-tier results
3. Clicks "Upgrade to Interactive Code Review"
4. Fills 6-field signup form
5. Goes through 6-10 adaptive Q&A questions with live score updates
6. **Uploads supporting documents** during some questions (journal entries, emails, design docs) and sees scores update based on the evidence — with clear UI copy confirming originals aren't stored
7. Clicks "Finish Review"
8. Waits 60-120 seconds
9. Lands on `/review-complete.html` with **TWO PDFs visible** — the Invention Disclosure Form and the Filing-Ready Patent Application Draft
10. Receives both PDFs by email

At no point is payment required (because of the bypass token). Without the token, the flow is blocked at signup with a "Payment coming soon" message.

The two PDFs are attorney-ready:
- IDF formatted like `AI_Patentability_Disclosure_IDF-2026-0042.docx` — what an attorney reads to understand the invention
- Application formatted like `SlidingPrefetchWindow_PatentSpec.docx` — the actual draft patent text, ready for attorney review and USPTO filing

Both documents carry the non-negotiable disclaimers: "CONFIDENTIAL — ATTORNEY WORK PRODUCT", "DRAFT — NOT LEGAL ADVICE", "Patent PreCheck is not a law firm and does not provide legal services."

---

## When You Reach Blockers

If you hit genuine blockers (e.g., Netlify Lambda timeout limits for PDF generation, Resend setup complexity), push what you have and ask Kevin for direction rather than substantially reshaping the brief. Document the blocker in the PR description.

If something in this brief conflicts with a locked decision in `PROJECT_STATE.md` or any of the scoped files (`ENGINE_STATE.md`, `FEATURES_STATE.md`, etc.), stop and ask Kevin. Never silently override locked decisions.

---

## Push When Ready

Push each commit on its own branch:
- `feat/code-review-rename`
- `feat/code-review-backend`
- `feat/code-review-frontend`
- `feat/code-review-delivery`

Wait for Kevin's approval after each before moving to the next.

Good luck.
