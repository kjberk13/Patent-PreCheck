# Claude Code Handoff Brief — Patent PreCheck Backend Implementation

**Date:** April 17, 2026
**Status:** Architecture complete, v1 engine scaffolded, ready for build-out
**Scope of this brief:** Standing up the patentability engine backend — ingestion pipeline, vector store, API endpoints, and integration with the existing Netlify site.

---

## How to use this brief

Paste everything below (from the `## Project context` heading to the end of `## Phase 2.6 — Deployment`) as your opening message in your first Claude Code session. It gives Claude Code everything it needs to pick up where chat-based development left off and execute the backend implementation without re-grounding.

You will need the following before starting:
- Local directory where the Patent PreCheck code should live (suggest `~/projects/patentprecheck/`)
- GitHub repo created and cloned (suggest `github.com/kjberk13/patentprecheck`)
- The `patentability-engine-v1.zip` extracted into the repo at `/backend/patentability/`
- The `patentprecheck-handoff-2026-04-16.zip` extracted into the repo at `/handoff/`
- An Anthropic API key available as `ANTHROPIC_API_KEY` in your shell environment
- Node.js 20+ installed locally
- Docker installed (for local pgvector)

---

## Project context

I'm Kevin Berk, building Patent PreCheck — an AI patentability platform for developers. The product analyzes code and technical descriptions and returns a structured score estimating patentability under current US patent law, with coaching guidance to strengthen weak areas.

The product has two parallel algorithms, both updated daily:

1. **Legal Intelligence Algorithm** — monitors 166 sources (courts, USPTO, law firms, news) for changes to patent law that affect users' scores. Backend code already exists at `/handoff/02-backend/legal_sources.js`. Not your focus; leave it alone.

2. **Patentability Assessment Algorithm** — evaluates whether a specific invention is new, non-obvious, and useful. Backend scaffolded at `/backend/patentability/`. **This is what you're building out.**

Existing assets:
- Website live at `https://patentprecheck-1776362495343.netlify.app` (9 HTML pages)
- Chrome extension built and zipped, awaiting Chrome Web Store submission
- Copyright registered: Case #1-15142210311 (April 14, 2026)
- Domain: `patentprecheck.com` (owned, not yet pointed at Netlify)

Critical design decisions already made — do not re-litigate these:
- **Free sources only in v1.** No paid commercial databases yet (PatSnap, Derwent, LexisNexis). Tier H is defined but disabled.
- **Cached subset, not full corpus.** Index the software-relevant slice (CS/software patents, CS papers, high-star open-source repos). Not all 200M patents. Not all 240M papers.
- **LLM: Claude Sonnet 4** via the Anthropic SDK. Model ID: `claude-sonnet-4-20250514`.
- **Tone: supportive coach.** "Opportunity to strengthen" not "problem to fix." Enforced in the system prompt.
- **Messaging rules (strict):** Never name sources publicly. Never state source counts. Never mention LLMs. Never imply examiner routing manipulation. Lead with outcomes.

---

## What's already built (read these files first)

Start by reading these in order:

```
/backend/patentability/README.md                 # architecture overview
/backend/patentability/patentability_sources.js  # 58 free sources across 7 tiers
/backend/patentability/patentability_engine.js   # scoring logic
/backend/patentability/prior_art_search.js       # domain classifier and search interface
/backend/patentability/netlify_function.js       # HTTP endpoint (needs integration)
```

Then orient on the site:
```
/handoff/01-website/                             # all 9 HTML pages
/handoff/01-website/analyze.html                 # upload form (not yet wired to backend)
```

The scoring architecture is locked:
- **Gate:** Subject matter category (process / machine / manufacture / composition)
- **Pillars (weighted):** §101 Eligibility (25%) + §102 Novelty (25%) + §103 Non-Obviousness (30%) + §101 Utility (10%) + §112 Filing Readiness (10%)
- **Band floors enforced:** File Ready requires all patentability pillars ≥ 70, Strong requires all ≥ 50

Do not change these weights or the band rules without asking me.

---

## Phase 2.1 — Local development environment

Set up the repo to support a real engineering workflow. Current state (chat-based bundle passing) needs to be replaced.

1. Initialize the project as a proper Node monorepo if it isn't already. Structure:
   ```
   patentprecheck/
     apps/
       website/          # the 9 HTML pages (static)
     backend/
       patentability/    # the engine (you're extending this)
       legal-intel/      # existing; leave alone
       shared/           # shared utilities
     infra/
       docker/           # local dev compose files
       migrations/       # pgvector schema
     .env.example
     package.json
   ```

2. Create a top-level `package.json` with `@anthropic-ai/sdk` as a dependency (Netlify requires top-level installation; function-local `package.json` is not auto-installed).

3. Create `.env.example` with every variable the system will need. Actual `.env` stays gitignored.

4. Set up `eslint` + `prettier` with reasonable defaults for Node. Commit the config.

5. Confirm everything boots: `npm install`, `node --check` every JS file in `backend/patentability/`, no errors.

Commit when this phase is done. Use clear commit messages throughout — this repo will be auditable.

---

## Phase 2.2 — Stand up pgvector locally

Use Postgres 16 with pgvector. Docker Compose for local dev; we'll swap to managed Postgres (Neon or Supabase) when deploying.

1. Write `infra/docker/docker-compose.yml` that runs `pgvector/pgvector:pg16` on port 5433 (avoid 5432 conflicts) with a named volume and credentials loaded from `.env`.

2. Write the initial schema migration at `infra/migrations/001_init.sql`:
   - Extension: `CREATE EXTENSION IF NOT EXISTS vector;`
   - Table: `prior_art_documents` with columns: `id` (uuid primary key), `source_id` (text), `doc_type` (text), `title` (text), `abstract` (text), `full_text` (text nullable), `url` (text), `published_at` (timestamptz), `ingested_at` (timestamptz), `language` (text default 'en'), `metadata` (jsonb), `embedding` (vector(1536))
   - Index on embedding: `CREATE INDEX ON prior_art_documents USING hnsw (embedding vector_cosine_ops)`
   - Partial index on source_id for fast dedup: `CREATE INDEX ON prior_art_documents (source_id) WHERE source_id IS NOT NULL`
   - Additional table: `source_ingestion_log` tracking last successful run per source (source_id, last_run_at, docs_ingested, error text nullable)

3. Write a migration runner script at `backend/shared/run_migrations.js` that applies migrations in order and tracks applied migrations in a `migrations_applied` table.

4. Document setup in `backend/README.md`: docker-compose up, run migrations, verify connectivity with a simple `SELECT version();`.

Commit.

---

## Phase 2.3 — Embedding layer

Abstract the embedding provider so we can swap between Anthropic embeddings (when available), OpenAI embeddings, or open-source models (bge-large, jina-embeddings).

1. Create `backend/shared/embeddings.js` exporting a single `embed(text)` function that returns a 1536-dim vector. Default provider: Voyage AI (recommended by Anthropic for use with Claude; `voyage-3` model, 1024-dim — pad or use `voyage-3-large` for 1536). Fallback: OpenAI `text-embedding-3-small`.

2. Implement batching: `embedBatch(texts, { batchSize = 100 })` that handles rate limits with exponential backoff.

3. Write a simple test at `backend/shared/__tests__/embeddings.test.js` that embeds two similar strings and one unrelated string and verifies cosine similarity ranks them correctly. Use `node --test`.

4. Write `backend/shared/vector_search_adapter.js` — the pgvector adapter that `prior_art_search.js` currently expects. Interface: `search({ query, limit, source_tiers, source_weights })` returning an array of `{title, source_id, source_name, doc_type, url, snippet, date, similarity_score, source_tier}`.

5. Integration test: seed 10 dummy docs, run a search, verify results make sense.

Commit.

---

## Phase 2.4 — Ingestion workers (this is the bulk of the work)

Build workers for the high-priority sources first. All 58 sources eventually, but prioritize by expected value. Implementation order:

### 2.4.1 USPTO PatentsView (Tier A, CRITICAL)
- Endpoint: `https://search.patentsview.org/api/v1/patent/`
- Free, no auth, generous rate limit
- Write `backend/patentability/workers/patentsview_worker.js`
- Initial backfill: software-classified patents (CPC classes G06F, G06N, G06Q, H04L) from 2015 onward
- Daily delta: fetch patents with `patent_date` within last 7 days
- For each patent: extract abstract, claims, generate embedding, upsert into `prior_art_documents` with source_id = `uspto-patentsview`

### 2.4.2 Google Patents via BigQuery (Tier A, CRITICAL)
- BigQuery dataset: `patents-public-data.patents.publications`
- Free tier: 1TB queries/month
- Write `backend/patentability/workers/google_patents_worker.js`
- Use this for global coverage (EP, WIPO, CN, JP, KR) that PatentsView doesn't cover
- Same CPC filter; same document shape

### 2.4.3 arXiv (Tier B, CRITICAL)
- API: `http://export.arxiv.org/api/query`
- Write `backend/patentability/workers/arxiv_worker.js`
- Initial backfill: cs.* and stat.ML categories from 2018 onward
- Daily delta: new submissions in last 24h
- Extract title, abstract, authors, categories

### 2.4.4 Semantic Scholar (Tier B, CRITICAL)
- API: `https://api.semanticscholar.org/graph/v1/paper/search`
- Free with API key (request via their site)
- Write `backend/patentability/workers/semantic_scholar_worker.js`
- Complements arXiv with cross-publisher coverage

### 2.4.5 GitHub (Tier C, CRITICAL)
- API: `https://api.github.com/search/repositories`
- Unauth: 60 req/hr. With PAT: 5000 req/hr. Use a PAT.
- Write `backend/patentability/workers/github_worker.js`
- Filter: min 50 stars, has README, language in {Python, JavaScript, TypeScript, Rust, Go, C++, Java}
- Ingest: repo name, description, README content, topic tags
- This is the big one for software novelty hits

### 2.4.6 USPTO Office Actions + PTAB (Tier E, CRITICAL)
- USPTO Open Data Portal: https://developer.uspto.gov
- Office Action API and PTAB API both free
- Write `backend/patentability/workers/uspto_exam_worker.js`
- This feeds the Phase 3 examiner calibration layer. For v1, just ingest structured; use later.

### 2.4.7 All remaining sources
- One worker file per source. Keep them small and similar-shaped.
- Priority order for the rest: Papers With Code → Hugging Face → OpenReview → Lens.org → Software Heritage → RFCs → Technical Disclosure Commons → OpenAlex → Crossref → DBLP → IEEE Xplore → remaining patent offices → remaining academic sources → remaining code sources

### Worker pattern (apply to all)
- Single file per source
- Exports `async function run({ mode })` where mode is `'backfill' | 'delta'`
- Logs to `source_ingestion_log` on start/success/failure
- Retryable with exponential backoff on 429/5xx
- Idempotent (safe to re-run; upsert by `source_id:native_id`)
- Chunking: process in batches of 100 docs to avoid memory spikes

### Orchestrator
- `backend/patentability/ingestion_pipeline.js`
- Runs workers in priority order
- Invoked via cron: full daily delta at 2am Pacific, weekend backfill window
- Exposes a CLI: `node ingestion_pipeline.js --mode delta --source arxiv` for targeted runs

Commit after each worker is complete and tested.

---

## Phase 2.5 — Wire the Netlify function to the real engine

The current `netlify_function.js` in `/backend/patentability/` has a `getVectorStoreIfConfigured()` stub that returns null. Replace it with a real adapter that connects to the Postgres instance via connection pool.

Requirements:
1. Import the `vector_search_adapter.js` from Phase 2.3
2. Use a connection pool (`pg.Pool`) with reasonable limits for Netlify Functions (max 3 connections per function container)
3. Handle cold-start latency — first request should complete in under 10 seconds; subsequent requests should be under 3 seconds
4. On vector store failure, fall back to LLM-only scoring (don't hard-fail; the engine handles it)

Test the full flow: local curl against the function with a 500-character code sample → returns a JSON response with all 5 pillar scores, bands, and top opportunities.

Commit.

---

## Phase 2.6 — Deployment

1. **Database:** Provision a Neon or Supabase Postgres with pgvector enabled. Migrate the schema. Set connection string as `DATABASE_URL` in Netlify env vars.

2. **Ingestion runner:** Deploy the ingestion pipeline to Railway or Render (both have good cron support and can run long jobs). The backfill for USPTO + arXiv + GitHub will take 24–72 hours on initial run; don't worry about it, just let it run.

3. **Netlify function:** Deploy `netlify_function.js` as `netlify/functions/patentability-analyze.js`. Confirm environment variables in Netlify: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `VOYAGE_API_KEY` (or whichever embedding provider).

4. **Wire analyze.html:** The form at `/handoff/01-website/analyze.html` currently posts nowhere. Update it to POST to `/.netlify/functions/patentability-analyze` with `{ code, filename, tier: 'free' }` and render the response.

5. **Redeploy the site** with the new wiring. Confirm end-to-end: upload a code snippet, receive a real score backed by real prior art search.

Commit. Push. Call it v1.

---

## What not to build right now

Do NOT build these in this phase. They are Phase 3 work that comes later:

- **USPTO Examiner Calibration layer.** The Office Action data ingestion in 2.4.6 sets the foundation, but the actual calibration modeling is a separate multi-week project. We'll do it after v1 ships and we have usage data.
- **Outcome tracking.** Users reporting back whether their filings succeeded. Phase 3.
- **Commercial database integrations.** Tier H sources. Not until revenue supports the spend.
- **Multi-application filing strategy.** Enterprise feature, Phase 3.
- **Messaging changes on the website.** Kevin will handle site copy updates through the chat interface. Don't modify any HTML files beyond wiring the analyze form.

---

## Communication protocol with Kevin

- Commit often with clear messages. Push to a feature branch, not main, until a phase is complete.
- If you hit an ambiguous decision, pause and flag it. Don't invent product-level decisions.
- Log every external API you register with and the credential names you expect. Kevin needs to set them up on his side.
- When a phase is done, write a one-paragraph summary of what was built, what's tested, and what's not yet working. Kevin will review before you proceed to the next phase.
- If a source's API is broken, deprecated, or rate-limited beyond usefulness, skip it and move to the next priority. Note which sources were skipped and why.
- If the scoring behavior changes in a way Kevin might care about (a pillar weight feels wrong, a band threshold is off), flag it for review before committing.

---

## Success criteria for Phase 2 complete

- [ ] Local dev environment boots in one command
- [ ] pgvector running with schema applied
- [ ] Embedding layer with passing tests
- [ ] At least the 6 CRITICAL-priority workers implemented and tested
- [ ] Ingestion pipeline running with logging
- [ ] Netlify function integrated with real vector store
- [ ] analyze.html wired to the function
- [ ] End-to-end test: upload code, receive scored response with prior art references
- [ ] Deployment docs in `backend/README.md` complete enough for someone else to reproduce

---

## Starting point for your first message in Claude Code

After pasting this brief, your first action should be:

1. Read the five files listed under "What's already built" in order. Do not skim.
2. Summarize back to Kevin what you understand is already built, what's the gap to v1, and what you think the right first concrete step is. Propose a plan for Phase 2.1 before executing.
3. Wait for Kevin's confirmation before writing any code.

Kevin is sensitive to scope creep and product drift. When in doubt, ask first.
