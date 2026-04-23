# PROJECT_STATE.md — Patent PreCheck

**Canonical index for Patent PreCheck. Maintained in the repo root and referenced at the start of every Claude conversation, Claude Code PR, and engineering decision.**

**Last updated:** 2026-04-22 by Kevin + Claude
**Current phase:** 2.6 complete, 2.7 in planning (Interactive Code Review build)

---

## How to use this file

This file is the **master index**. Scoped state files live alongside it in the repo root. When starting a new conversation or briefing Claude Code, reference the scoped file most relevant to the task — not this index file for every decision.

### Scoped state files

| File | Scope | When to read |
|---|---|---|
| `INFRA_STATE.md` | Hosting, database schema, env vars, site map | Deploy changes, migrations, env var updates |
| `DATA_STATE.md` | Current corpus (16,030 docs) | Ingestion work, backfill operations |
| `ENGINE_STATE.md` | Two-score engine, four pillars, scoring methodology (50/35/15), evidence categories | Engine changes, scoring UX, AI inventorship work |
| `FEATURES_STATE.md` | Interactive Code Review UX spec, operational workflows, phased backlog | Feature builds, roadmap conversations |
| `DESIGN.md` | Color, typography, spacing, components, accessibility, copy patterns | Any visual or copy work |
| `LEGAL_INTELLIGENCE.md` | Daily legal pipeline, Tier 1+2 sources, Phase 3 architecture | Phase 3 work, source list questions |
| `PRIVACY_TERMS.md` | Privacy policy + Terms of Use framework | Privacy HTML updates (Phase 2.7), legal disclaimer work |
| `OPEN_QUESTIONS.md` | Resolved decisions log + pending questions | When a decision feels ambiguous or unresolved |

### Starting a new Claude conversation

> "Continuing work on Patent PreCheck. The project state is indexed in `PROJECT_STATE.md` with scoped files. Most relevant for this task: [cite specific scoped file(s)]. Recent decisions: [anything from today]. Here's what I need: [your current task]."

### Briefing Claude Code

> "Before starting, read `PROJECT_STATE.md` and the relevant scoped files ([list]). All locked decisions there are authoritative. If your work changes any locked section, update the appropriate scoped file as part of the PR."

### When locked decisions conflict with a new request
Ask Kevin before overriding. Never silently override locked decisions.

---

## Section 1 — Product Identity

**Name:** Patent PreCheck™ *(trademark asserted via ™, not yet federally registered)*

**What it is:** An AI-powered patentability pre-screening platform for software inventors. Takes code, invention descriptions, or AI conversation logs; returns a patentability score, prior art matches, and drafting guidance — before the user spends money on attorney time or filing fees.

**Positioning:** "The smart pre-attorney step." Not replacing patent attorneys — saving founders money by helping them refine their invention before expensive legal time.

**Target users:**
- Solo software founders filing their first patent
- Early-stage startups (seed to Series A) protecting IP
- IP attorneys using it for client work (secondary)

**Core promise (all three equally):**
- Avoid wasting filing fees on doomed claims
- Draft stronger claims that survive examiner review
- Know what specific language causes rejections in your space

**Brand tone:** Positive and coaching. Never negative framing.
- Use "↑ Opportunity" not "⚠ Problem"
- Use "Strengthen by..." not "Your weakness is..."
- Celebrate progress ("You're more than halfway there")

**What the product is NOT:**
- Not legal advice
- Not a replacement for a patent attorney
- Not a guarantee of patent grant

Every marketing surface includes variations of: *"We're not attorneys, and we don't replace one. But we'll save you significant time and money before you get to that stage — so when you do meet with counsel, you arrive prepared."*

---

## Section 2 — Tiers & Pricing (LOCKED)

| Tier | Name | Price | What you get |
|---|---|---|---|
| Free | Patent PreCheck Score | $0 | Instant score (0–100) + 4-pillar breakdown + top prior art matches + basic drafting hints |
| Paid | Interactive Code Review | **$69.95** one-time | Multi-turn refinement + evidence upload + IDF PDF + filing-ready patent application draft PDF + email delivery + 30-day window |
| Re-review | Patent Re-Check | $29.99 | For existing customers when case law shifts or filing matures |
| Enterprise | Portfolio Dashboard | Custom | Team conception tracking, investor IP audit, portfolio-level monitoring |

**Pricing is locked.** Do not relitigate without Kevin's approval.

**Key note:** The Interactive Code Review is fundamentally different from a static PDF report — it's a multi-turn experience with live scoring updates AND produces TWO deliverables (IDF + filing-ready application). See `FEATURES_STATE.md` for full UX spec.

---

## Section 15 — User / Founder Info

**Kevin J. Berk** — co-founder, CEO
- Email: kjberk13@gmail.com
- Phone: (480) 861-7474
- Address: 6314 E. Aster Drive, Scottsdale, AZ 85254
- Location: Scottsdale, AZ (Mountain Time)

**Registered copyright:** Case #1-15142210311, filed 2026-04-14

**Working style notes for Claude:**
- Non-technical but fast-learning; can follow clear step-by-step instructions
- Prefers comprehensive deliverables with strategic prioritization and actionable next steps
- Values honest scope accounting (what's aspirational vs. what's shipped)
- Appreciates the "take a break while Claude Code works asynchronously" pattern
- Terminal-novice: requires step-by-step walkthroughs with explicit navigation
- Takes screenshots rather than copy-pasting Terminal output
- Humor lands well
- Running multiple major projects in parallel (Patent PreCheck, PURE Pickleball & Padel, Chaparral Track nonprofit, BHG)

---

## Section 16 — Claude Code Working Patterns

### Branch + FF-merge flow
1. Claude Code creates work on a branch (typically `claude/patent-precheck-review-jsXQ5` or feature branch)
2. Tests run locally (lint, format:check, syntax-check, test)
3. Push to origin
4. Kevin approves via chat
5. Claude Code FF-merges to `main` and pushes
6. Netlify + Railway auto-deploy within ~60 seconds

### Claude Code invocation checklist
When writing a brief for Claude Code:
- State the goal and in-scope items explicitly
- List explicit out-of-scope items (prevents scope creep)
- Reference the relevant scoped state file(s) if locked decisions apply
- Request scoped state file maintenance as part of every substantive PR
- Specify test coverage expectations
- Note any schema/migration changes
- Specify operator steps needed post-merge (env vars, migrations, manual config)

### Scoped file maintenance
Claude Code updates the relevant scoped file(s) in every PR that changes:
- Deployed infrastructure → `INFRA_STATE.md`
- Schema (migrations applied or added) → `INFRA_STATE.md`
- Environment variables → `INFRA_STATE.md`
- Feature scope or decisions → `FEATURES_STATE.md`
- Engine behavior or scoring → `ENGINE_STATE.md`
- Copy patterns or design → `DESIGN.md`
- Backlog status → `FEATURES_STATE.md`
- Legal intelligence → `LEGAL_INTELLIGENCE.md`
- Privacy/terms → `PRIVACY_TERMS.md`

Updates go in the relevant section of the relevant scoped file, with date stamps where appropriate.

### When a scoped file grows too large
Split further. Suggested thresholds: ~8,000 words triggers review, ~10,000 words triggers mandatory split. If a scoped file splits, add a new row to the index table above.

---

*End of PROJECT_STATE.md index. All substantive content is in the scoped files listed above.*
