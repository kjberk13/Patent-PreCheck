# FEATURES_STATE.md — Patent PreCheck Features & Roadmap

**Scope:** Interactive Code Review UX spec, operational workflows, phased backlog/roadmap.
**Parent:** `PROJECT_STATE.md` (index)

---

## Interactive Code Review (Paid Tier) UX Spec

**Status:** Not yet built. Phase 2.7 target.

### Core promise
Walk the user through their invention section-by-section, helping them strengthen specific claims, with live score updates as they refine. End with two downloadable PDFs + emailed copies.

### Interaction model
**Not** a static PDF generator. **Not** a chat interface. Closer to a guided editor experience with live feedback.

### Entry points
- **Paid path (future):** Stripe checkout after free analyze
- **Beta bypass (current):** Single secret URL with query param, e.g., `/analyze.html?access=BETA2026`. If token matches `BETA_ACCESS_TOKEN` env var, user goes through the full signup/checkout flow but payment step is bypassed.

### User journey
1. User runs free analyze first (per existing flow)
2. Free results render, user sees upgrade CTA: "Get the full Interactive Code Review — $69.95"
3. User clicks upgrade
4. Signup form collects (ALL REQUIRED):
   - First name
   - Last name
   - Email
   - Phone
   - Formal mailing address (line 1, line 2, city, state, zip, country)
   - Business address (same-as-formal checkbox, or separate fields)
5. Submit → backend validates, persists signup, and begins interactive session
6. **Interactive session** (the heart of the feature):
   - User sees their invention broken into sections/issues
   - Engine highlights specific "Opportunity" areas in positive-coaching tone
   - User edits text inline, sees live score updates (e.g., 71 → 74, +3)
   - User can upload supporting documents (see Evidence Upload section below) — uploads raise scores
   - Engine provides encouraging feedback per edit ("That's a great start" / "Nice refinement")
   - When user marks an issue "done," next area auto-loads with positive handoff
   - Session persists; user has 30-day window to return
7. When all issues resolved (or user finalizes early):
   - Engine produces refined scores + final drafting guidance
   - **Two PDFs generated** — IDF and filing-ready patent application draft
   - Both emailed to user + displayed on-screen + available in web view for 30 days

### Tone requirements (LOCKED)
- "↑ Opportunity" not "⚠ Problem"
- "Strengthen by..." not "Fix this..."
- "You're making progress" / "Nice work" / "Great start"
- Never negative or accusatory language

### Data handling (LOCKED)
- **Hash the user's code/input, store hash only** (not raw content)
- Session state held in memory during 30-day window; content erased after
- Signup data (name, email, phone, addresses) stored in `code_review_signups` table
- Never store raw code or text content
- Evidence uploads processed once, originals discarded (see Evidence Upload section)

### Interactive session content — structured questions (LOCKED)

The interactive session content is derived from the `AI_Patentability_Inventor_Interview_Checklist.docx` (Morgan Lewis + Holland & Knight recommended practice). The checklist has four parts; the Interactive Code Review walks users through all four:

**Part I — Conception and Problem Framing** (5 questions)
- Describe the specific technical problem this invention solves. What was failing in existing approaches?
- When did you first have a clear idea of the solution? What were you doing at that moment, and what specifically did you conceive?
- Before using any AI tool, had you already formed a hypothesis about the approach?
- What design constraints were you working under (performance, memory, latency, domain rules)?
- Did you identify the specific problem before prompting the AI, or did the AI suggest the problem?

**Part II — Prompt Engineering and AI Interaction** (5 questions)
- Walk through how you framed your prompts. General goals or specific technical constraints?
- When the AI returned a suggestion, what criteria did you use to evaluate it?
- Describe a specific AI suggestion you rejected and why.
- Describe the most significant modification you made to an AI suggestion and why it was technically necessary.
- Were there AI-generated parameters (thresholds, coefficients) you replaced with values from your own measurements?

**Part III — Feature-by-Feature Confirmation** (4 questions per claimed feature)
- What did you specifically conceive for this feature, independent of AI output?
- What would have been missing if AI had not been used? What was your unique contribution beyond directing it?
- Describe a specific AI suggestion for this feature that was rejected and why.
- Is there a conception moment document, journal entry, or timestamp evidencing this contribution?

**Part IV — Inventor Declarations** (6 checkboxes confirming human conception)

**How the Interactive Code Review surfaces these:**
- Not a long form — questions are drip-surfaced one at a time based on detected gaps in the free-tier analysis
- Engine uses free-tier results to identify which questions are most critical (skip questions where contribution is already clear)
- Each answer updates scoring in real time per the rubric in ENGINE_STATE.md
- User sees score shifts (e.g., "71 → 74, +3") with encouraging framing
- Questions feel conversational, not bureaucratic

### Evidence upload capability (LOCKED as of 2026-04-22)

During the Interactive Code Review, users can upload supporting documents that Claude evaluates to strengthen their evidence scores. Uploads are integrated directly into the Q&A flow — when a user answers a question, they can attach supporting files as part of the same submission.

**Supported file types:**
- Documents: PDF, DOCX, TXT, MD (journal entries, design docs, email exports, Slack archives)
- Images: PNG, JPG, HEIC (whiteboard photos, notebook scans, screenshots) — processed via OCR
- Code: common source files (.js, .py, .ts, .java, .go, .rs, etc.)
- Archives: ZIP (for multi-file evidence bundles like exported email threads)

**Per-upload metadata captured:**
- Upload timestamp (server-side, cannot be forged)
- User-claimed document date (optional but valuable — if claimed date is before AI involvement, this significantly raises Conception Moment Evidence)
- Which category the upload supports (Problem Framing / Constraints / Conception Moment / Decision Record)
- Brief user-written description ("March 15 journal entry where I first articulated the variance approach")

**Evidence extraction pipeline:**
1. User uploads file
2. Claude reads/extracts text (OCR for images, standard parsing for docs)
3. Claude evaluates whether content supports the user's claimed evidence:
   - Does the content mention the specific technical problem/solution?
   - Does the claimed date align with document metadata (where available)?
   - Is the writing pre-AI-era-appropriate (before AI use claimed for this project)?
4. Score update for the relevant evidence category (per rubric in ENGINE_STATE.md)
5. Extracted structured evidence stored in session state as JSONB

**Storage policy (LOCKED — Option C, strictest available):**

Patent PreCheck NEVER stores the original uploaded files. The pipeline is:
1. File is read once by Claude for evidence extraction
2. Structured output (extracted date, category support, text summary, supporting-or-not judgment) is stored
3. Original file is immediately discarded
4. User retains their original — we do not store backup copies

Implications:
- Users MUST keep their own copies of uploaded evidence
- If users need to re-reference evidence, they re-upload
- Evidence bundle in the final PDF contains summaries and user-provided descriptions, NOT the originals
- User's attorney will need the originals from the user, not from Patent PreCheck
- This is the maximally privacy-respecting architecture consistent with PRIVACY_TERMS.md ("no raw code or text content stored")

**Privacy policy implications (see PRIVACY_TERMS.md):**
- Data collection list must include: "Document upload metadata (filename, upload timestamp, user-claimed document date, user-written description, category designation)"
- Do-not-store list must include: "We do NOT retain copies of uploaded files after evidence extraction. Users must retain their own originals."
- UI must make this crystal clear at the upload point: "Keep your own copy — we don't store originals"

**How uploads translate to scores:**
- Text match to user's Q&A answer: +10-20% bonus on the relevant category
- Claimed date within 30 days of claimed conception moment: +15% to Conception Moment
- Claimed pre-AI date (user provides date, document metadata agrees): +25-40% to whichever category — pre-AI evidence is high-value
- Multiple supporting documents for same category: diminishing returns after 2-3 (prevents gaming)
- Scoring cap at 100% per category regardless of uploads — can't exceed filing-ready

**UI display of uploaded evidence:**
- Per category, show count of supporting documents
- Hover/click to see each document's filename, claimed date, brief description
- Users can mark a document as supporting multiple categories (one pre-AI journal entry might help Problem Framing + Conception Moment)
- Documents show as "processed and included" — no preview/download, consistent with "no originals stored"

### Interactive Code Review output (LOCKED as of 2026-04-22)

The $69.95 Interactive Code Review produces **two deliverables** — an Invention Disclosure Form (IDF) AND a filing-ready patent application draft. Both are generated as part of the paid tier.

**Deliverable 1 — Invention Disclosure Form (IDF)**

Modeled on `AI_Patentability_Disclosure_IDF-2026-0042.docx` from the prior project bundle. This is the attorney-briefing document — what a patent attorney reads to understand the invention before drafting. Contains:

1. **Invention overview** — title, field, technical background, problem statement
2. **Scoring summary** — AI Patentability Score (weighted 50/35/15 per ENGINE_STATE.md), per-feature breakdown, Patentability + Filing Readiness scores
3. **Human contribution documentation** — 4-category framework evidence (per ENGINE_STATE.md), per-claim human conception percentages
4. **Claim candidate identification** — draft independent claim language for each supportable feature
5. **Alice Step 1 and Step 2 analysis** — why claims survive eligibility (per Enfish, BASCOM, distinguished from Recentive/Rensselaer)
6. **Prior art differentiation** — specific patents/papers from the corpus flagged as nearest art, with distinguishing language
7. **AI tool disclosure statement** — compliant with USPTO 2025 Revised Inventorship Guidance (Nov 28, 2025)
8. **Evidence bundle summary** — list of supporting documents the user uploaded (names, claimed dates, which categories they support) — does NOT include the original files
9. **Next steps for attorney handoff** — what the attorney needs to do, estimated attorney time savings

**Report ID:** `PPC-YYYY-MM-DD-XXXX-IDF`

**Deliverable 2 — Filing-Ready Patent Application Draft**

Modeled on `SlidingPrefetchWindow_PatentSpec.docx` from the prior project bundle. This is the actual patent application text, ready for attorney review and filing with USPTO. Contains:

1. **Formal title** of invention
2. **Cross-reference to related applications** — fields for provisional/continuation claims (user/attorney fills)
3. **Statement regarding federally sponsored research** — standard placeholder
4. **Field of the invention** — formal statement
5. **Background** — prior-art framing written to set up eligibility arguments
6. **Summary of the invention** — inventive-concept recitation
7. **Brief description of drawings** — placeholder for attorney-commissioned drawings
8. **Detailed description of preferred embodiments** — claim-supporting text with §112 written description support
9. **Draft claims** — independent and dependent, numbered, with Alice Step 1 + Step 2 language
10. **Abstract** — 150-word patent office summary
11. **Counsel notes** — throughout, flagging where attorney judgment is required
12. **Inventor declaration placeholder** — 37 C.F.R. § 1.63 oath template
13. **AI tool disclosure statement** — per USPTO 2025 guidance

**Report ID:** `PPC-YYYY-MM-DD-XXXX-APP`

**Critical legal framing for both deliverables:**

Every page of both documents must include prominent disclaimers:
- "CONFIDENTIAL — ATTORNEY WORK PRODUCT"
- "DRAFT — NOT LEGAL ADVICE"
- "All claim language, specification text, and legal arguments must be reviewed and confirmed by a licensed patent attorney prior to filing."
- "Patent PreCheck is not a law firm and does not provide legal services."

This disclaimer language is non-negotiable — it protects against UPL (unauthorized practice of law) risk.

**Delivery format:**
- Both documents generated as PDF via puppeteer-core + @sparticuz/chromium
- Both emailed to the user + downloadable from the web view
- User can regenerate with refined scores/evidence during the 30-day review window

### Out of scope for v1 (Phase 2.7)
- Stripe integration (beta bypass only)
- User accounts / login (each Interactive Code Review is a one-off transaction)
- Admin dashboard for managing multiple beta codes
- Rejection pattern analysis engine (Phase 3)
- Full USPTO Federal Register + CAFC opinion ingestion (Phase 3 — see LEGAL_INTELLIGENCE.md)

### Technical scope estimate
7-10 days Claude Code time for v1 with:
- Signup form + hash-based persistence
- Beta bypass URL + token validation
- Multi-turn session state management with drip question surfacing
- Evidence upload pipeline (Option C storage: process once, never persist originals, extract structured evidence)
- Live score updates (client-side display + server-refined scoring incorporating uploaded evidence)
- PDF generation with puppeteer-core + @sparticuz/chromium — **TWO deliverables** (IDF + filing-ready patent application draft)
- Report templating for both documents with legal disclaimers, counsel notes, Alice Step 1/2 framing
- Email delivery (Resend) attaching both PDFs
- Privacy policy update (including no-upload-storage language)
- Terms of Use update

---

## Operational Workflows

### Daily delta cron
- Schedule: Railway cron `0 9 * * *` (9 UTC = 2 AM Pacific)
- Runs `ingest-delta` service with default `--mode=delta`
- Pulls recent items from USPTO, arXiv, GitHub
- Small incremental corpus updates

### Health-ping cron
- Schedule: `*/15 * * * *` (every 15 min)
- Hits `/.netlify/functions/analyze` with a canned invention payload
- Keeps Lambda warm; costs ~$0.03/day

### Manual backfill
To trigger a backfill from any source:
1. Railway → ingest-delta → Variables
2. Add `INGEST_MODE=backfill`, `INGEST_LIMIT=<n>`, `INGEST_SOURCE=<source>`
3. Railway auto-redeploys
4. Watch logs for `ingest_checkpoint` events every 100 docs
5. When complete, delete the three INGEST_ variables (returns to delta mode)

---

## Backlog / Roadmap

### Phase 2.6 — COMPLETE (2026-04-21)
- ✅ Netlify git-linked deploys
- ✅ Railway provisioning + env vars
- ✅ USPTO ODP migration (from legacy PatentsView)
- ✅ Voyage 1024-dim (migrated from 1536)
- ✅ 15K USPTO smoke backfill
- ✅ Analyze page with file upload + paste-text
- ✅ Homepage flagship section + ™ treatment
- ✅ End-to-end validated with real user input (self-test against Patent PreCheck's own copyright deposit)

### Phase 2.7 — Interactive Code Review (current)
- Interactive Code Review feature (see UX spec above)
- Signup form + bypass token
- Evidence upload pipeline
- Dual PDF generation (IDF + filing-ready patent application)
- Email delivery (Resend)
- **Privacy policy update** per PRIVACY_TERMS.md
- **Terms of Use update** per PRIVACY_TERMS.md

### Phase 2.8 — Optional quick wins
- Textarea auto-expand (currently rows=40, too tall)
- arXiv backfill (~8K papers, ~45 min — operator task)
- Rename Railway project from `distinguished-endurance` to `patent-precheck-prod`
- Logo brain outline contrast boost (from ~32% to ~60-75% white opacity)
- Email capture on free analyze flow (start building list)

### Phase 3 — Rejection Pattern Analysis + Legal Intelligence
- Ingest abandoned applications + office actions from USPTO ODP
- New schema: rejection bases (§101/102/103/112), rejection language embeddings
- Engine integration: new sub-pillar or enhancement to existing pillars
- UI surface: "Claims similar to yours that got rejected" section (without displaying specific patents — per "never disclose methods" rule)
- Deploy daily legal intelligence pipeline (see LEGAL_INTELLIGENCE.md) — Tier 1 + 2 sources only, ~50 free sources
- Estimated: 5-8 days Claude Code time

### Phase 3.5 — USPTO Office Actions Deep Dive
- More complex data extraction than basic RSS/JSON pulls
- Weekly ingestion of abandoned applications
- Examiner rejection language embeddings
- Estimated: separate 3-5 day sprint after Phase 3 stabilizes

### Phase 4 — Commercial Launch
- Connect patentprecheck.com to Netlify (domain migration)
- Set up Stripe products ($69.95 + $29.99)
- Replace beta bypass with Stripe checkout
- File provisional patent ($320 USPTO) — time-sensitive
- Register "Patent PreCheck Score" + "AI Patentability Algorithm" trademarks federally
- Chrome Web Store submission (extension already built)
- **Activate Tier 3 premium legal research sources** (Lexis+ AI, Westlaw Precision) — only after paying subscriber base justifies the ~$1-4K/month subscription cost. PatSnap and Clarivate Derwent are NOT on this list — removed as duplicative of USPTO ODP direct ingestion.

### Phase 5 — Attorney Network, Enterprise & Assisted Filing
- Recruit IP attorneys for network page
- Enterprise portfolio dashboard
- Team conception tracking
- Investor IP audit workflow
- **Assisted filing platform** — Patent PreCheck files on behalf of users
  - **Copyright-assisted filing** (simpler, ship first within Phase 5):
    - Integration with U.S. Copyright Office eCO system
    - Form submission + $65 fee handling
    - Deposit copy upload
    - Status tracking
    - Estimated 2-3 days Claude Code
  - **Patent-assisted filing** (more complex, ship after copyright):
    - USPTO EFS-Web electronic filing integration
    - Filing fee handling ($320-$1,500 depending on entity size/claims)
    - Inventor identity verification (government-issued ID, real-name KYC)
    - May require registered patent agents on staff for certain representation activities
    - Provisional patent filing first, full utility later
    - Estimated 2-4 weeks Claude Code plus significant legal/regulatory work
  - **Pricing:** Premium add-ons. Copyright ~$199. Patent provisional ~$499. Full utility filing — separate product with higher price point and attorney partnership.

---

*End of FEATURES_STATE.md. See PROJECT_STATE.md for the index.*
