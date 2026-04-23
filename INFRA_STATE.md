# INFRA_STATE.md — Patent PreCheck Infrastructure

**Scope:** Live infrastructure, database schema, environment variables, site map.
**Parent:** `PROJECT_STATE.md` (index)

---

## Live Infrastructure

### Production URLs
- **Live site:** https://patentprecheck-1776362495343.netlify.app *(Netlify-generated subdomain)*
- **Target domain:** patentprecheck.com *(not yet connected — pending)*
- **GitHub repo:** https://github.com/kjberk13/Patent-PreCheck

### Hosting & Services

| Layer | Service | Role | Status |
|---|---|---|---|
| Static site + Lambda | **Netlify** | Serves `apps/website/*` + hosts `/netlify/functions/analyze` Lambda | Live, git-linked to `main`, auto-deploys |
| Long-running workers | **Railway** (Hobby $5/mo) | Runs `ingest-delta` + `health-ping` services, daily cron | Live, git-linked to `main`, auto-deploys |
| Database | **Neon** (Launch tier $19/mo) | Postgres with pgvector extension, HNSW index on `prior_art_documents.embedding vector(1024)` | Live, migrations current |
| Embeddings | **Voyage AI** | voyage-3-large model, 1024 dimensions (Matryoshka) | Live, paid tier active |
| LLM | **Anthropic** (Claude) | Claude Sonnet 4 for analysis, summarization | Live |
| Patent data | **USPTO ODP** (data.uspto.gov) | Primary patent source (PatentsView was retired May 2025) | Live, API key active |
| Academic data | **arXiv** | Research paper prior art | Live, ingestion worker active |
| Code data | **GitHub Search API** | Open-source code prior art | Live, fine-grained token active |

### Deploy Pattern (LOCKED)
Every change goes through GitHub. No drag-drop deploys.
1. Claude Code pushes to a review branch
2. FF-merge to `main`
3. Netlify + Railway auto-deploy within 60 seconds
4. Claude Code maintains the relevant `*_STATE.md` files as part of every PR

### Railway Project Naming
Railway auto-generated the project as `distinguished-endurance`. Should be renamed to `patent-precheck-prod` for clarity (backlog).

---

## Database Schema (Current)

### `prior_art_documents`
Stores ingested patents, papers, and code repos for similarity search.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| source_id | TEXT | `uspto-patentsview`, `arxiv`, `github-search` |
| external_id | TEXT | Source's native ID |
| title | TEXT | |
| abstract | TEXT | May be null for USPTO (not in bulk search response) |
| content | TEXT | Full text where available |
| metadata | JSONB | Source-specific fields (CPC codes, filing date, etc.) |
| embedding | vector(1024) | Voyage embedding, HNSW-indexed with vector_cosine_ops |
| ingested_at | TIMESTAMPTZ | |

### `embedding_cache`
Deduplicates embedding calls.

### `source_ingestion_log`
Tracks per-run status, cursors, doc counts.

### Migrations Applied
- `001_init.sql` — initial schema
- `002_embedding_cache.sql` — cache table
- `003_resize_embedding_to_1024.sql` — dimension migration from 1536 → 1024 (Voyage Matryoshka-compliant)

### Planned Migrations (not yet applied)
- `004_code_review_signups.sql` — user signup data for Interactive Code Review *(hash-only storage, no raw code)*; includes `code_review_evidence` sub-table per FEATURES_STATE.md
- `005_office_actions.sql` — rejection pattern data (Phase 3)
- `006_analysis_reports.sql` — report persistence for PDF generation (may be superseded by 004 depending on build order)

---

## Environment Variables

### Railway (applied as Shared Variables to both services)
| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Neon direct connection | No `-pooler`, plain `postgresql://...` |
| `ANTHROPIC_API_KEY` | Claude calls | |
| `ANTHROPIC_MODEL` | Model selection | `claude-sonnet-4-20250514` |
| `VOYAGE_API_KEY` | Embedding calls | Paid tier active |
| `EMBEDDING_PROVIDER` | Routes embeddings | `voyage` |
| `EMBEDDING_MODEL` | Voyage model | `voyage-3-large` |
| `EMBEDDING_DIMENSIONS` | Vector size | `1024` (NOT 1536) |
| `USPTO_API_KEY` | USPTO ODP auth | `X-Api-Key` header |
| `GITHUB_TOKEN` | GitHub Search auth | Fine-grained, public repo read-only (CASE-SENSITIVE uppercase) |
| `HEALTH_CHECK_URL` | health-ping target | `https://patentprecheck-1776362495343.netlify.app/.netlify/functions/analyze` |

### Railway (temporary / operator-controlled)
Set these only when running a backfill; delete after.
- `INGEST_MODE` — `backfill` or `delta` (default delta if unset)
- `INGEST_LIMIT` — number
- `INGEST_SOURCE` — `uspto-patentsview`, `arxiv`, or `github-search`
- `INGEST_RESUME`, `INGEST_FORCE`, `INGEST_DRY_RUN`, `INGEST_CHECKPOINT_INTERVAL` — optional

### Netlify (applied at site level)
Same as Railway for the Lambda function, plus:
- `BETA_ACCESS_TOKEN` *(planned — Phase 2.7)* — for Interactive Code Review bypass URL
- `RESEND_API_KEY` *(planned — Phase 2.7)* — for PDF email delivery

### Secrets storage
All secret values stored in Kevin's local TextEdit file + password manager. Never committed to git. Never pasted into Claude conversations.

---

## Site Map

| Page | Path | Purpose | Status |
|---|---|---|---|
| Homepage | `/index.html` | Product overview, pricing, value prop | Live (with new flagship section as of 2026-04-21) |
| Analyze | `/analyze.html` | Free tier entry point (upload OR paste) | Live (with text-paste + file-upload) |
| Platform | `/platform.html` | How the product works | Live (dated; may need rewrite) |
| Filing | `/filing.html` | Assisted filing info | Live |
| Legal intelligence | `/legal-intelligence.html` | Daily legal updates feature | Live (copy only; backend not deployed — see LEGAL_INTELLIGENCE.md) |
| Attorneys | `/attorneys.html` | Attorney network page | Live (recruitment copy) |
| Notebook | `/notebook.html` | Inventor's Notebook feature (Coming Soon) | Live (placeholder) |
| Privacy | `/privacy.html` | Privacy policy | Live (needs update for Interactive Code Review data collection — see PRIVACY_TERMS.md) |
| Terms | `/terms.html` | Terms of service | Live (needs update — see PRIVACY_TERMS.md) |
| Review signup | `/review-signup.html` | 6-field signup for Interactive Code Review | **Planned — Phase 2.7** |
| Review complete | `/review-complete.html` | Post-finalize landing page with PDF downloads | **Planned — Phase 2.7** |

---

*End of INFRA_STATE.md. See PROJECT_STATE.md for the index.*
