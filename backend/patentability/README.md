# Patent PreCheck — Patentability Engine v1.0

Structured scoring engine evaluating uploaded code/inventions against the
three statutory requirements for patentability (novelty, non-obviousness,
utility) plus the §101 eligibility filter and §112 filing readiness.

## What's here

| File | Purpose |
|------|---------|
| `patentability_sources.js` | Registry of 58 free prior art and examination data sources across 7 tiers. Proprietary — never published externally. |
| `patentability_engine.js`  | Core scoring logic. LLM-driven pillar assessment with weighted aggregation and band-floor enforcement. |
| `prior_art_search.js`      | Domain classifier and prior art retrieval interface. Routes queries to relevant source tiers based on technology domain. |
| `netlify_function.js`      | HTTP endpoint wiring prior art search → scoring engine. Replaces the old `analyze.js`. |

## Scoring architecture

### Gate (pass/fail)
- **Subject Matter (§101 category)** — Must be process / machine / manufacture / composition. If content is a business plan, abstract concept, or other non-eligible subject matter, no score is issued.

### Pillars (0–100 each)
| Pillar | Statute | Weight | User-facing question |
|---|---|---|---|
| Eligibility | §101 Alice/Mayo | 25% | Is it more than an abstract idea? |
| Novelty | §102 | 25% | Is it new? |
| Non-Obviousness | §103 | 30% | Is it inventive? |
| Utility | §101 utility prong | 10% | Does it work and does it matter? |
| Filing Readiness | §112 | 10% | Is your documentation strong enough to file? |

### Band rules (enforced floors, not just weighted average)
| Band | Weighted score | Required floor on every patentability pillar |
|---|---|---|
| File Ready | ≥ 80 | ≥ 70 |
| Strong Position | ≥ 60 | ≥ 50 |
| Building | ≥ 40 | — |
| Not Ready | 0–39 | — |

A score of 82 with one pillar at 55 does **not** hit File Ready. The
`band_held_back_by` field surfaces which pillar is the limiter so the user
knows exactly what to strengthen.

## Source registry at a glance

58 free sources, 7 tiers:

- **Tier A** — Patent & application databases (14 sources): USPTO PatentsView, Google Patents, EPO OPS, WIPO, Espacenet, The Lens, JPO, KIPRIS, CNIPA, DPMA, CIPO, IP Australia
- **Tier B** — Academic & technical literature (11): arXiv, Semantic Scholar, OpenAlex, Crossref, CORE, BASE, DBLP, IEEE Xplore, ACM DL, SSRN, PubMed
- **Tier C** — Open-source code & technical disclosure (12): GitHub, GitLab, Sourcegraph, Stack Overflow, Hacker News, Product Hunt, Software Heritage, npm, PyPI, Crates.io, Docker Hub, RFC Editor
- **Tier D** — Defensive publications (2): Technical Disclosure Commons, IBM TDB
- **Tier E** — USPTO examination data (7): Office Action Dataset, PTAB Decisions, Public PAIR, BDSS, MPEP, CPC Classification, Art Unit Allowance Stats
- **Tier F** — Standards & specs (3): W3C, IETF RFCs, NIST Publications
- **Tier G** — AI/ML-specific (9): Papers With Code, Hugging Face, OpenReview, Google AI, Meta AI, Microsoft Research, DeepMind, Anthropic, OpenAI

**Tier H** (commercial/paid) is defined but commented out. Enabled when
revenue supports the spend (PatSnap, Derwent, LexisNexis PatentAdvisor,
etc.). No public messaging changes when enabled — users see the same
feature description.

## Deployment

### 1. Top-level `package.json` (project root)

Netlify does **not** auto-install function-local dependencies. Add to the top-level project `package.json`:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0"
  }
}
```

Commit `package.json` and `package-lock.json` to the repo.

### 2. Netlify environment variables

Required:
- `ANTHROPIC_API_KEY`

Optional (enables prior art search; without them the engine falls back to LLM-only assessment):
- `PINECONE_API_KEY` + `PINECONE_INDEX` OR
- `PGVECTOR_URL` (Postgres with pgvector extension)

### 3. Function placement

Copy all four JS files into `netlify/functions/`. Rename `netlify_function.js` → `patentability-analyze.js` to match the URL path.

Endpoint will be: `POST /.netlify/functions/patentability-analyze`

### 4. Wire the analyze.html upload button

The form on `analyze.html` currently goes nowhere. Wire it to POST
`{ code, filename, tier: 'free' }` to the function endpoint and render the
response using the scoring breakdown component.

## Public messaging rules (the line we walk)

**Say:**
- "Scored against the three statutory requirements for patentability"
- "Reviewed against prior art from daily-updated sources across US, Europe, WIPO, and academic literature"
- "Historically-successful framings for inventions in your technical area"
- "Strengthen your position before you file"

**Never say:**
- Named sources (list is proprietary)
- Source counts ("60+ sources" — vague is fine, specific is not)
- Anything implying examiner or art unit routing manipulation
- "Higher approval odds" or "acceptance rate improvement"
- That the underlying analysis uses an LLM

Lead with outcomes (the score, the strengthen-it guidance, the record), never methods.

## Phase 2 roadmap

1. **USPTO Examiner Calibration layer** (the deepest moat). Ingests
   PEDS/Public PAIR/Office Action Dataset; builds art-unit-level behavior
   models; calibrates pillar scores and guidance to the art unit the
   invention will likely be examined in. Messaging externally stays
   generic — "calibrated to how inventions in your technical area are
   typically evaluated."

2. **Outcome tracking**. Users who file based on Patent PreCheck reports
   can report outcomes back; system refines its predictions over time.
   This converts the product from analysis to prediction.

3. **Commercial database tier**. Enable Tier H (PatSnap, Derwent, LexisNexis)
   as revenue supports. No user-facing messaging change.

4. **Multi-application filing strategy** (enterprise). For portfolios,
   generate continuation/divisional strategies with per-application art
   unit targeting — defensible when done transparently and for filing
   strategy, not examiner avoidance.

## File integrity

All four JS files pass `node --check` syntax validation. Runtime testing
requires the Anthropic SDK installed (`npm install @anthropic-ai/sdk`) and
a valid API key.
