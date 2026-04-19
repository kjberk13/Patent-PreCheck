# Deploying Patent PreCheck

End-to-end runbook for a production-like deploy. Three surfaces:

- **Neon** — managed Postgres with pgvector (already provisioned; see "Database")
- **Netlify** — static site + `analyze` serverless function
- **Railway** — ingestion worker host (daily deltas, ad-hoc backfills, health-ping cron)

## Architecture at a glance

```
┌─────────────┐   POST /.netlify/functions/analyze
│  Browser    │ ──────────────────────────────────────┐
│ analyze.html│                                        │
└─────────────┘                                        ▼
                                                ┌────────────────┐
                                                │ Netlify Lambda │
                                                │   analyze.js   │
                                                └────────────────┘
                                                        │
                                     ┌──────────────────┼──────────────────┐
                                     │                  │                  │
                                     ▼                  ▼                  ▼
                             Anthropic API       Voyage embedding     Neon Postgres
                              (summary + score)   (1536-dim vectors)   (pgvector)
                                                                             ▲
                                                                             │
                           ┌─────────────────────────────────────────────────┤
                           │                                                 │
                   ┌──────────────┐                                  ┌──────────────┐
                   │   Railway    │ ─── cron: ingest-delta (daily) ──┤  Worker deps │
                   │  worker svc  │ ─── cron: health-ping (15 min) ──┤  (pg, fetch) │
                   └──────────────┘                                  └──────────────┘
```

---

## Database (Neon) — already live

Provisioned in Phase 2.5. Two connection strings exist:

- `DATABASE_URL` — direct endpoint, used by migrations + workers
- `DATABASE_URL_POOLED` — pooled endpoint, used by the Netlify Lambda

Migrations are applied via `npm run migrate` pointed at `DATABASE_URL`. Re-run is idempotent (checksum-verified).

**To apply a new migration in production:**

```bash
DATABASE_URL='<neon-direct-url>' npm run migrate
```

The runner will refuse if a prior migration's checksum drifts. Add a _new_ migration file — never edit an applied one.

---

## Netlify — site + analyze function

### One-time setup

The old drag-deploy workflow (zip `apps/website/`, drop onto app.netlify.com) no longer works because the Lambda bundler needs `backend/` at build time. Switch to a git-linked build:

1. In the Netlify dashboard, go to Site settings → Build & deploy → Continuous deployment → Link to Git repository.
2. Connect to `github.com/kjberk13/Patent-PreCheck`.
3. Base directory: (blank — repo root)
4. Branch to deploy: `main`
5. Build command: (auto-detected from `netlify.toml`)
6. Publish directory: (auto-detected: `apps/website`)

The repo-root `netlify.toml` drives everything else:

- `publish = "apps/website"` — the static site
- `functions = "netlify/functions"` — the Lambda(s)
- `[functions."analyze"] external_node_modules = ["pg"]` — keeps `pg` out of the Lambda bundle

### Environment variables (already set)

| Key                           | Source                       | Used by                    |
| ----------------------------- | ---------------------------- | -------------------------- |
| `ANTHROPIC_API_KEY`           | console.anthropic.com        | Lambda: summary + score    |
| `ANTHROPIC_MODEL`             | `claude-sonnet-4-20250514`   | Lambda                     |
| `VOYAGE_API_KEY`              | voyageai.com                 | Lambda: embed              |
| `OPENAI_API_KEY` _(optional)_ | openai.com                   | Lambda: embedding fallback |
| `EMBEDDING_PROVIDER`          | `voyage`                     | Lambda + workers           |
| `EMBEDDING_MODEL`             | `voyage-3-large`             | Lambda + workers           |
| `EMBEDDING_DIMENSIONS`        | `1536`                       | Lambda + workers           |
| `DATABASE_URL`                | Neon direct                  | Workers, migrations        |
| `DATABASE_URL_POOLED`         | Neon pooled                  | Lambda                     |
| `SITE_URL`                    | `https://patentprecheck.com` | —                          |
| `LOG_LEVEL`                   | `info`                       | All                        |

### Deploy

```bash
git push origin main
```

Netlify auto-builds and deploys. Function logs live at Site → Functions → analyze.

### Cold-start budget

Function bundle is ~1.2 MB zipped (well under 50 MB limit). Cold start dominated by `@anthropic-ai/sdk` init, ~200–400 ms. End-to-end analyze latency ~15–20 s (dominated by two Claude calls).

---

## Railway — ingestion worker + health-ping

### One-time setup

1. Create a Railway account at railway.app, upgrade to **Hobby plan ($5/mo)** — the free plan's 500 execution-hours/mo ceiling is fine for delta ingestion but blocks long-running backfills.
2. New project → Deploy from GitHub → `kjberk13/Patent-PreCheck`.
3. Railway detects `railway.json` and `Procfile`, registers two processes: `ingest-delta` and `health-ping`.

### Environment variables to set in Railway

Same LLM + embedding + database vars as Netlify, plus ingestion source tokens:

| Key                                                             | Notes                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`                                                  | Neon **direct** (not pooled) — `pg.Pool` wants the direct endpoint |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`                          | —                                                                  |
| `VOYAGE_API_KEY`, `OPENAI_API_KEY` _(optional)_                 | —                                                                  |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | same values as Netlify                                             |
| `GITHUB_TOKEN`                                                  | PAT with `public_repo` read — required by the GitHub worker        |
| `SEMANTIC_SCHOLAR_API_KEY`                                      | When the semantic-scholar worker lands                             |
| `IEEE_API_KEY`                                                  | When the ieee worker lands                                         |
| `BIGQUERY_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`         | When the google-patents worker lands                               |
| `LOG_LEVEL`                                                     | `info` in production, `debug` when you need cache-hit/miss counts  |
| `HEALTH_CHECK_URL`                                              | `https://patentprecheck.com/.netlify/functions/analyze`            |

### Cron schedules

Set in the Railway dashboard (Service → Settings → Cron) or via CLI. Suggested cadence:

| Process        | Schedule                                | Purpose                                     |
| -------------- | --------------------------------------- | ------------------------------------------- |
| `ingest-delta` | `0 9 * * *` (09:00 UTC = 02:00 Pacific) | Daily delta across every implemented worker |
| `health-ping`  | `*/15 * * * *`                          | Keep Lambda warm + catch regressions        |

### Initial backfill (Phase 2.6.1 smoke)

**Target:** ~23k docs total, ~90 min wall time, ~$2 Voyage spend.

```bash
# Log in
railway login
railway link    # link to the project

# arXiv cs.LG, 2025-Q1 forward (~8k docs, ~45 min)
railway run npm run ingest -- --source=arxiv --mode=backfill --limit=8000

# USPTO G06N (AI/ML) last 24 months (~15k docs, ~45 min)
railway run npm run ingest -- --source=uspto-patentsview --mode=backfill --limit=15000
```

Watch logs in Railway dashboard while running. Successful completion writes a row to `source_ingestion_log` with `status='success'`.

### Phase 2.6.2 full demo corpus

Only after 2.6.1 is clean. ~115k docs, ~5 hrs, ~$6 Voyage.

```bash
# Expand arXiv to cs.AI + cs.CL from 2023
railway run npm run ingest -- --source=arxiv --mode=backfill --limit=50000

# Extend patents back to 2020 + broader CPC groups (adjust the worker's cpcGroups)
railway run npm run ingest -- --source=uspto-patentsview --mode=backfill --limit=35000

# GitHub (requires GITHUB_TOKEN set)
railway run npm run ingest -- --source=github-search --mode=backfill --limit=5000
```

### Resuming a failed backfill

```bash
railway run npm run ingest -- --source=arxiv --mode=backfill --resume
```

If the prior run is older than 24 hours the runner refuses; re-run with `--force` to accept the gap:

```bash
railway run npm run ingest -- --source=arxiv --mode=backfill --resume --force
```

---

## Observability (v1)

- **Netlify function logs** — JSON-per-line; searchable at Site → Functions → analyze → Logs.
- **Railway service logs** — same JSON-per-line format; Railway keeps 7 days on Hobby.
- **Ingestion run history** — `SELECT * FROM source_ingestion_log ORDER BY started_at DESC LIMIT 20;`
- **Health-ping failures** — Railway dashboard surfaces failed cron runs; configure email alerts in Railway → Service → Notifications.

Sentry + longer log retention are deferred (see Phase 2.6 plan). Add when traffic justifies.

---

## Rollback

### Netlify function

Netlify keeps every deploy. Dashboard → Deploys → pick a prior deploy → Publish. Instant rollback.

### Railway

Dashboard → Deployments → redeploy a prior build. Slightly slower (rebuilds).

### Database

No automatic rollback for migrations. The checksum guardrail prevents silent drift; if you need to undo, write a new migration that reverses the change. The HNSW index can be rebuilt in place from the data without downtime (`REINDEX INDEX CONCURRENTLY`).
