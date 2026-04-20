# Backend

Patentability and legal-intelligence services for Patent PreCheck.

## Layout

```
backend/
  patentability/   # v1 scoring engine (§101 / §102 / §103 / §112 pillars)
  legal-intel/     # legal-change monitoring + notifier
  shared/          # cross-service utilities (migration runner, etc.)
```

See each subdirectory's `README.md` for service-specific docs.

## Local dev quickstart

Requirements:

- Node.js 20+ (see `.nvmrc`)
- Docker (for the local pgvector container)

### 1. Install and configure

```bash
# From the repo root
npm install
cp .env.example .env
# Edit .env — minimum required to get the database running:
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT,
#   and a matching DATABASE_URL
```

The defaults in `.env.example` already work out of the box for local dev.

### 2. Start Postgres + pgvector

```bash
npm run db:up      # brings up pgvector/pgvector:pg16 on ${POSTGRES_PORT:-5433}
npm run db:logs    # tail the container logs (optional)
```

Useful companions:

- `npm run db:down` — stop the container (data persists in the `patentprecheck_pgdata` volume)
- `npm run db:reset` — stop **and drop the volume** (destroys all data; use for a clean reinstall)

### 3. Apply migrations

```bash
npm run migrate
```

The runner:

- reads `DATABASE_URL` from `.env`
- applies any `infra/migrations/*.sql` file that hasn't been recorded in `migrations_applied`, in filename-sorted order
- wraps each migration in its own transaction
- stores a sha256 checksum of every applied file; on any subsequent run, a mismatch (someone edited a migration that was already applied) fails loudly. The fix is to revert the file or write a **new** migration — never to silently reapply.

### 4. Verify connectivity and schema

```bash
# Connect (reads creds from .env via psql's variable substitution)
psql "$DATABASE_URL"
```

Inside `psql`:

```sql
SELECT version();
\dx                                 -- expect the `vector` extension
\dt                                 -- expect prior_art_documents, source_ingestion_log, migrations_applied
SELECT * FROM migrations_applied;   -- expect one row for 001_init.sql
```

### 5. Sanity check the vector index

```sql
-- Insert three documents with orthogonal 1024-dim embeddings.
-- Alpha points along dim 1, Beta along dim 2, Gamma along dim 3.
INSERT INTO prior_art_documents (source_id, native_id, doc_type, title, embedding)
SELECT 'test', 'alpha', 'patent', 'Alpha',
       ('[' || string_agg(CASE WHEN n = 1 THEN '1.0' ELSE '0.0' END, ',') || ']')::vector
FROM generate_series(1, 1024) AS n;

INSERT INTO prior_art_documents (source_id, native_id, doc_type, title, embedding)
SELECT 'test', 'beta', 'patent', 'Beta',
       ('[' || string_agg(CASE WHEN n = 2 THEN '1.0' ELSE '0.0' END, ',') || ']')::vector
FROM generate_series(1, 1024) AS n;

INSERT INTO prior_art_documents (source_id, native_id, doc_type, title, embedding)
SELECT 'test', 'gamma', 'patent', 'Gamma',
       ('[' || string_agg(CASE WHEN n = 3 THEN '1.0' ELSE '0.0' END, ',') || ']')::vector
FROM generate_series(1, 1024) AS n;

-- Nearest-neighbor search with a query vector leaning toward Alpha (dim 1).
WITH q AS (
  SELECT ('[' || string_agg(
            CASE WHEN n = 1 THEN '0.95' WHEN n = 2 THEN '0.3' ELSE '0.0' END,
            ',') || ']')::vector AS v
  FROM generate_series(1, 1024) AS n
)
SELECT title, ROUND((1 - (embedding <=> q.v))::numeric, 4) AS cosine_similarity
FROM prior_art_documents, q
ORDER BY embedding <=> q.v
LIMIT 5;
```

Expected ordering: **Alpha** (~0.95), then **Beta** (~0.30), then **Gamma** (0.00).
Swap the `WHEN n = 1` / `WHEN n = 3` branches in the query to see it flip to Gamma.

## Migrations

Files live in `infra/migrations/NNN_description.sql`, applied in filename order. To add a new migration:

1. Pick the next prefix (`002_`, `003_`, …).
2. Write idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc.).
3. Run `npm run migrate`.
4. **Never edit an already-applied migration** — the runner will refuse. Add a new migration that performs the desired change.
