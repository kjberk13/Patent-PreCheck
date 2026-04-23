# LEGAL_INTELLIGENCE.md — Patent PreCheck Legal Intelligence Pipeline

**Scope:** Architectural commitment for how Patent PreCheck stays current with patent law. Daily ingestion of Tier 1+2 sources, engine integration, alerting.
**Parent:** `PROJECT_STATE.md` (index)

---

**The differentiator.** Patent PreCheck's core value proposition depends on the engine reflecting *current* patent law — not Claude's training data cutoff, not yesterday's legal landscape. This file commits to what the engine will ingest, how often, and how it surfaces updates to users.

---

## Current State vs. Target State (Gap Analysis)

### What the engine ingests TODAY (Phase 2.6)

| Source | Status | Frequency | Purpose |
|---|---|---|---|
| USPTO ODP patent filings | ✅ Live | Daily delta | Prior art corpus |
| arXiv papers | ✅ Live | Daily delta | Academic prior art |
| GitHub Search (public repos) | ✅ Live | Daily delta | Open-source prior art |

### What the engine DOES NOT ingest yet (Phase 3 / 3.5 scope)

| Source | Status | Target Frequency | Purpose |
|---|---|---|---|
| USPTO Federal Register notices | ❌ Not ingested | Daily | Regulatory guidance changes (e.g., Nov 2025 inventorship update) |
| USPTO office actions / rejections | ❌ Not ingested | Daily | Rejection pattern analysis |
| USPTO abandoned applications | ❌ Not ingested | Weekly | What didn't make it through |
| Federal Circuit (CAFC) opinions | ❌ Not ingested | Daily | Precedential rulings |
| PTAB decisions | ❌ Not ingested | Weekly | Appeals and IPR outcomes |
| District Court patent rulings | ❌ Not ingested | Weekly | Infringement and validity rulings |
| USPTO MPEP updates | ❌ Not ingested | On publication | Examiner guidance changes |
| Supreme Court IP decisions | ❌ Not ingested | On publication | Top-of-stack legal rulings |
| Legal practitioner commentary (IPWatchdog, Patently-O, etc.) | ❌ Not ingested | Daily | Early-warning signals |

**The gap:** When the engine produces scores today, it's evaluating against patent filings (current) but legal framework (training-data frozen). This creates a risk — the engine could produce confident scores based on outdated doctrine.

**November 2025 as a concrete example:** USPTO rescinded the 2024 AI inventorship guidance and issued new guidance. An engine relying on pre-2024 training data would evaluate AI-assisted inventions under the old Pannu-factor framework even though it's been explicitly rescinded. This is the exact failure mode the legal intelligence pipeline prevents.

---

## Target Architecture

**Ingestion layer (what goes into the system):**
Daily fetch from Tier 1 and Tier 2 sources only for initial Phase 3 deployment (approximately 50 free sources). Tier 3 premium services are deferred until revenue justifies the cost. Code basis: `legal_sources_v3.js` file in the prior project bundle (written, not deployed).

### Tier 1 — Government & Courts (free, authoritative) — DAILY

**USPTO:**
- Patent filings (granted patents) — ✅ already live as of Phase 2.6
- Patent News RSS (general USPTO news)
- Federal Register notices
- Federal Register rules
- Federal Register proposed rules
- AI inventorship Federal Register queries
- Trademark news RSS

**Copyright Office:**
- News RSS
- Federal Register notices

**Federal Courts (via CourtListener):**
- CAFC (Federal Circuit) all opinions — daily
- CAFC patent cases — daily
- AI/inventorship/human conception queries — daily
- Section 101/Alice-Mayo queries — daily
- SCOTUS IP decisions — daily
- Specifically monitored cases: Columbia Univ. v. Gen Digital (March 2026 — geographic damages), Fortress Iron (inventorship transparency)

**USPTO Office Actions & Rejections (Phase 3.5 scope):**
- Office actions — daily (what examiners are rejecting and why)
- Abandoned applications — weekly (what didn't survive examination)
- Note: these require more complex data extraction than basic RSS/JSON pulls, which is why they're scoped to Phase 3.5, a follow-on to the core Phase 3 deployment

**International & Other Federal Agencies:**
- WIPO (International IP News, Patent News)
- EPO (European Patent Office News)
- UK IPO
- FTC (Technology & IP Policy)
- NIST (AI Standards via Federal Register)
- Federal Register — AI Executive Orders

### Tier 2A — Core IP blogs (free)
IPWatchdog (main, AI, software patents, Alice/101 categories), Patently-O, Patent Docs, Patent Hacks, SCOTUSblog IP

### Tier 2B — Law firm blogs (free)
~20 firms including Squire Patton Boggs, Finnegan, Fish & Richardson, Morrison Foerster, Cooley, Wilson Sonsini, Fenwick, Perkins Coie, Foley & Lardner, McDermott, K&L Gates, Pillsbury, Sterne Kessler, WilmerHale, Ropes & Gray, DLA Piper, Baker McKenzie, Orrick, Mintz, Sheppard Mullin

### Tier 2C — Legal news agencies (free)
Law360, JDSupra, Above the Law, IPKat, Managing IP, IAM Media, Clio

### Tier 2D — IP organizations (free)
AIPLA, IPO, INTA, LES, ACM, IEEE Spectrum

### Tier 2E — Academic journals (free)
SSRN (IP & Cyberlaw, AI & Law), Harvard JOLT, Stanford Technology Law Review, Michigan Tech Law Review, Cardozo

### Tier 2F — AI policy organizations (free)
AI Now Institute, Partnership on AI, Stanford AI Index, Brookings Tech, MIT Technology Review

### Tier 3 — Premium legal research (DEFERRED — not in Phase 3 scope)

Two paid services remain in the source registry but are deferred to Phase 4 (commercial launch) when revenue justifies monthly subscription costs. Both are legal research databases that aggregate case law and commentary in ways that supplement free Tier 1+2 sources:

- **Lexis+ AI** (Protégé assistant) — ~$500-2000/month. Legal research with AI-assisted case law analysis; valuable for tracking inventorship trends and emerging Section 101 rulings across jurisdictions.
- **Westlaw Precision** (CoCounsel, KeyCite) — ~$500-2000/month. Monitors specific precedent cases including Alice, Mayo, Bilski, Enfish, Berkheimer, Columbia v. Gen Digital, Thaler v. Vidal with citation tracking.

### REMOVED from source registry (2026-04-22)

- **PatSnap** — Enterprise patent search service ($30K-$100K/yr). Duplicates USPTO ODP (already ingested, authoritative, free). Also identified as "not a direct competitor" in the April 15, 2026 competitive analysis but operates in adjacent enterprise-R&D market. Not a fit for Patent PreCheck's data needs.
- **Clarivate Derwent** — Enterprise patent intelligence. Same rationale as PatSnap: duplicates our direct USPTO ingestion, no incremental value for our use case.

### Claude Code instructions

When deploying `legal_sources_v3.js`:
- Filter out any source with `tier:3` or `premium:true` flags
- Remove the PatSnap and Clarivate Derwent entries from the code entirely — they are no longer part of the target architecture
- Leave Lexis+ and Westlaw configured but disabled (so Phase 4 activation is a simple flag flip, not a re-add)
- The system should gracefully degrade without LEXIS_API_KEY or WESTLAW_API_KEY — no runtime errors when these env vars are absent

### Each ingested item carries
Title, source, date, full text, extracted key doctrines, material-change score, tier classification, relevance tags (e.g., `section101`, `alice`, `inventorship`, `patent`, `federal-circuit`, `rejection`, `office-action`).

### Evaluation layer (how the engine uses it)

Each time a user runs an analysis, the engine:
- Pulls the current doctrinal framework from the legal database (not from training data)
- Applies current tests for §101/§102/§103/§112 reflecting the latest rulings
- References specific recent cases when relevant ("Under [recent CAFC case], courts have held...")
- Flags when a recent ruling has materially changed how a specific claim type is evaluated

### Alerting layer (how users get updates)

- Paid-tier customers: daily/weekly email digest of material legal changes affecting their domain
- Re-review offering ($29.99) triggered when their technology area has a significant doctrinal shift
- Slack webhook for internal team when Tier 1 sources publish material changes (e.g., new USPTO guidance, major CAFC opinion)

---

## Phasing Plan

### Phase 3 — Core legal intelligence (5-8 days Claude Code)
- Deploy `legal_sources_v3.js` system with Tier 1 + Tier 2 sources only (~50 free sources)
- Filter out Tier 3 premium sources (Lexis+, Westlaw) — deferred to Phase 4
- PatSnap and Clarivate Derwent removed from registry entirely (see Target Architecture)
- Stand up daily cron ingestion to a new `legal_intelligence` schema
- Slack/email alerting for Tier 1 material changes (USPTO guidance, CAFC opinions, SCOTUS IP)
- Initial engine integration: reference legal database for §101/102/103/112 tests instead of frozen training data
- Does NOT require any premium API keys — gracefully degrades if they're absent

### Phase 3.5 — Rejection pattern analysis (5-8 days)
- Ingest office actions + abandoned applications from USPTO ODP
- Extract rejection bases and language patterns
- Train engine to identify high-rejection-risk claim structures
- Surface to users as drafting guidance (without displaying specific rejected patents — honors locked "never disclose methods" rule)

### Phase 4 — Full dynamic engine (open-ended, commercial launch)
- Full engine refactor to treat legal framework as a live database, not baked-in logic
- Doctrine versioning (so older reports reference the framework that was live when they were generated)
- Automated regression testing against seeded precedent cases
- Re-review automation (notify users when their filing area has a material shift)
- Activate Tier 3 premium sources (Lexis+ AI, Westlaw Precision) once revenue justifies

---

## Locked Commitments

These commitments are what the product promises (or will promise) — they're locked targets, not optional features:

### LOCKED: Legal currency
- Tier 1 sources ingested within 24 hours of publication
- Engine references the ingested legal framework, not training data
- When a ruling materially shifts doctrine, paid-tier users are notified

### LOCKED: Transparency of sources (internal)
- Full source list maintained internally but never disclosed publicly (per DESIGN.md "never disclose methods" rule)
- Marketing copy uses qualitative claims ("authoritative sources," "updated daily") — never specific counts

### LOCKED: Honest scope today
- Homepage copy "Updated daily" is accurate for **patent filings** (live)
- Homepage copy implying legal framework currency is **aspirational until Phase 3 ships**
- Do not over-promise in marketing until the legal intelligence pipeline is deployed

---

## Implications for Today's Marketing Copy

### Current homepage flagship section reads
> "Trained on thousands of real patent filings. Updated daily."

This is accurate. "Patent filings" + "daily" = true for what's ingested today.

### What it does NOT claim (correctly)
- "Updated daily with the latest USPTO rulings" — that would be aspirational
- "Reflects current legal doctrine" — that's aspirational

### What it implies but doesn't promise
The stats band's "Always current" and "Authoritative" language gestures toward legal freshness. This is acceptable as long as Phase 3 ships within a reasonable timeline. If Phase 3 is delayed >90 days, revisit the copy for over-promising risk.

---

## Open Questions (to resolve before Phase 3 kickoff)

- Tier assignment review: the ~50 Tier 1+2 sources in `legal_sources_v3.js` have inherited tier tags (tier:1, tier:2), but Kevin should do a final review to confirm priorities per individual source
- Where does the legal intelligence database live — same Neon instance or separate? (Recommend same Neon, new schema for unified querying)
- How does the engine incorporate legal updates into scoring — retraining, prompt injection with recent cases, or hybrid? (Likely prompt injection with structured doctrinal summary for first iteration)
- Re-review trigger thresholds — what counts as a "material" shift worth notifying users about?

---

## Resolved 2026-04-22

- ✅ **Tier 3 premium sources DEFERRED to Phase 4** — no premium API subscriptions in Phase 3. Tier 1 + Tier 2 only. Code should gracefully degrade without premium API keys.
- ✅ **PatSnap and Clarivate Derwent REMOVED from source registry** — duplicative of USPTO ODP direct ingestion; PatSnap also flagged as adjacent-market in April 15, 2026 competitive analysis. Only Lexis+ AI and Westlaw Precision remain as Phase 4 Tier 3 candidates (legal research databases, not patent search).

---

*End of LEGAL_INTELLIGENCE.md. See PROJECT_STATE.md for the index.*
