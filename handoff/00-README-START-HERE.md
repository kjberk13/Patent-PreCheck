# Patent PreCheck — Complete Project Handoff
**Bundle date:** April 16, 2026
**Status:** Live website deployed, backend ready for Replit, Chrome extension built

---

## Quick Start for the Next Claude Conversation

Paste this at the start of your new chat to give Claude full context:

> I'm continuing work on Patent PreCheck — an AI patentability platform for developers. I'm uploading a project bundle. Please read `00-README-START-HERE.md` first, then `07-transcripts/journal.txt` for session history, then the most recent transcript file (`2026-04-16-19-06-44-patent-precheck-product-dev.txt`) for full context. Then we'll continue.

---

## What Patent PreCheck Is

A full IP protection platform for developers building with AI tools. Three layers:

1. **Free Patent PreCheck Score** (0–100) — upload code/docs/AI conversations, get a score based on current US patent law (updated daily).
2. **$69.99 Full Interactive Review** — AI walks through the code section by section, suggests edits, score updates live, 30-day window. Includes Inventor's Notebook, summary PDF, 30-day legal monitoring, assisted filing access, attorney network access.
3. **$29.99 Re-review** — for older projects when case law changes.

**Enterprise:** Portfolio dashboard, team conception tracking, investor IP audit.

---

## What's Already Done

- ✅ Website built (9 HTML pages) and deployed live on Netlify
- ✅ Live URL: https://patentprecheck-1776362495343.netlify.app (and a deploy preview at https://69e1428b944f966667a97e24--patentprecheck-1776362495343.netlify.app)
- ✅ Domain owned: patentprecheck.com (not yet pointed at Netlify)
- ✅ Logo + brand identity (navy + green, Playfair Display + DM Sans)
- ✅ Backend code written (38-source legal monitoring, Stripe integration, alert notifier)
- ✅ Chrome extension built and zipped
- ✅ Copyright registration filed: Case #1-15142210311 (April 14, 2026, $65)
- ✅ Documents drafted (invention disclosures, patent spec, hygiene guide, IDF template, attorney interview checklist)
- ✅ Competitive analysis complete

## What's Pending (Priority Order)

1. **Connect patentprecheck.com domain** to Netlify (Site Settings → Domain Management → nameserver update)
2. **Deploy backend to Replit** — `02-backend/` folder contains everything ready
3. **Connect upload form to backend** — analyze.html's button currently goes nowhere
4. **Set up Stripe products** — $69.99 full review, $29.99 re-review prices
5. **File provisional patent** — $320 USPTO (TIME SENSITIVE before public launch)
6. **Trademark filing** — "Patent PreCheck Score" + "AI Patentability Algorithm"
7. **Build attorney network** — recruit IP attorneys specializing in AI inventorship
8. **Chrome Web Store submission** — needs live patentprecheck.com privacy URL first

---

## Bundle Contents

### `01-website/` — Live deployment-ready website
Drag the **folder contents** (not the folder itself) onto Netlify Drop. Already deployed to:
- Site ID: `334408c9-89f6-499c-a78c-08f3e514777a`
- Account: kjberk13@gmail.com

Pages:
- `index.html` — homepage with all 7 platform layers shown as a grid
- `analyze.html` — upload page (upload-first, upsell below) — **button not yet wired to backend**
- `platform.html` — full product suite, all 7 layers detailed
- `notebook.html` — Inventor's Notebook feature page
- `filing.html` — Assisted provisional patent + copyright filing
- `attorneys.html` — Attorney network + warm handoff
- `legal-intelligence.html` — Legal monitoring (NO source names revealed publicly)
- `privacy.html` — Two-promise data handling: code discarded, profile kept
- `terms.html` — Terms of service
- `nav.js` — Shared nav + footer (loaded by every page, single source of truth)
- `netlify.toml` — Deploy config

### `02-backend/` — Node.js backend (deploy to Replit)
- `legal_sources.js` — 38 sources across 4 tiers: USPTO, CourtListener, WIPO, EPO, UK IPO, CAFC, Finnegan PTAB, Knobbe Martens, Patent Docs, Foley Hoag, FOSS Patents, Unified Patents, plus Tier 3/4 premium APIs (Lexis+ AI, Westlaw Precision, PatSnap, Clarivate Derwent). **PROPRIETARY — never publish source list.**
- `notifier.js` — Slack + SendGrid email alert system with project-targeted alerts
- `stripe_server.js` — Payment endpoints: /checkout, /webhook (signature verified), /prices, /health
- `README.md` — Replit setup with all environment variables

### `03-logos/` — Brand assets
12 files: horizontal + stacked layouts × light + dark backgrounds × SVG/PNG/JPG
- Brain + neural network mark with green checkmark
- Animated checkmark fires once on page load (in SVG version)

### `04-documents/` — Working documents
- `SmartQueue_v2_Invention_Disclosure.docx` — example invention disclosure
- `SlidingPrefetchWindow_PatentSpec.docx` — example patent specification
- `AI_Patentability_Disclosure_IDF-2026-0042.docx` — formal disclosure
- `AI_Patentability_Good_Hygiene_Guide.docx` — developer hygiene guide
- `AI_Patentability_IDF_Template.docx` — blank invention disclosure template
- `AI_Patentability_Inventor_Interview_Checklist.docx` — attorney interview prep
- `patent_precheck_competitive_analysis.docx` — full market analysis

### `05-chrome-extension.zip` — Patent PreCheck Chrome extension
Already zipped, awaiting Chrome Web Store submission (needs live patentprecheck.com privacy URL first).

### `06-copyright-deposit-copy.txt` — Submitted with copyright registration
Case #1-15142210311, filed April 14, 2026, $65 fee.

### `07-transcripts/` — Full session history
- `journal.txt` — index of all sessions with summaries
- Latest two transcripts to read for full context

---

## Critical Decisions Already Made (Don't Re-Litigate)

### Pricing (FINAL)
| Product | Price |
|---|---|
| Free score | $0 |
| Full interactive review (30-day) | $69.99 |
| Re-review (existing accounts) | $29.99 |
| Enterprise | Custom |

### Data Handling (FINAL)
- **Code never stored.** Held in active session only. On close, user chooses: erase or save (paid users only).
- **Risk profile always kept** (free + paid): score, AI contribution level, technology domain, geographic distribution flag, §101 risk level. Used to send targeted legal alerts. **No code content. No text content.**
- **30-day legal alert guarantee** included with paid review.

### Branding (FINAL)
- **Colors:** Navy #0C2340, Blue #0C447C, Green #1D9E75
- **Fonts:** Playfair Display (headings) + DM Sans (body)
- **Logo:** Brain + neural network mark with checkmark

### What Never Goes Public
- Source list (38 named sources in legal_sources.js)
- Feed counts ("30+ sources" — vague is fine, specific numbers are not)
- Algorithm internals
- Risk flag taxonomy
- That underlying analysis uses an LLM
Lead with outcomes (score, monitoring, record), never methods.

### Tone of AI Review
**Positive and coaching.** "↑ Opportunity" not "⚠ Problem." "This area could be stronger" not "what's wrong." Score updates are wins. Every session ends with forward momentum.

---

## User Information

- **Name:** Kevin J. Berk
- **Email:** kjberk13@gmail.com
- **Phone:** (480) 861-7474
- **Address:** 6314 E. Aster Drive, Scottsdale, AZ 85254
- **Domain:** patentprecheck.com
- **Netlify account:** kjberk13
- **Netlify token (7-day, expires Apr 23 2026):** nfp_1XerwRvxPoo66t5yFPhg7woGVzssv8Y974d4
- **Copyright case:** #1-15142210311 (April 14, 2026, $65)

---

## Environment Variables Needed (When Deploying Backend to Replit)

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ONE_TIME       # $69.99
STRIPE_PRICE_REANALYZE      # $29.99
STRIPE_PRICE_PRO_SINGLE     # $49.99/mo (future)
STRIPE_PRICE_PRO_UNLIMITED  # $89.99/mo (future)
SENDGRID_API_KEY
SLACK_WEBHOOK
NOTIFY_EMAIL_TO=kjberk13@gmail.com
SITE_URL=https://patentprecheck.com

# Premium legal source APIs (when ready):
LEXIS_API_KEY
WESTLAW_API_KEY
PATSNAP_API_KEY
CLARIVATE_API_KEY
```

---

## Next Logical Step

Connect `patentprecheck.com` to the live Netlify site so the privacy policy URL is live → unlocks Chrome Web Store submission, Stripe setup with real domain, and trademark filing with a working website citation.
