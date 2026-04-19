-- =====================================================================
-- Patent PreCheck — migration 001: initial schema
--
-- Creates the pgvector extension and three tables:
--   prior_art_documents   — ingested prior art, one row per (source, native id)
--   source_ingestion_log  — per-run ingestion telemetry
--   migrations_applied    — migration bookkeeping (managed by run_migrations.js)
--
-- Design decisions (see Phase 2.2 brief for rationale):
--   • UUID primary keys via gen_random_uuid() (Postgres 13+ built-in)
--   • source_id + native_id split; UNIQUE on the pair is the upsert key
--   • No full_text column in v1 (not consumed by scoring pipeline; add later)
--   • HNSW index uses pgvector defaults (m=16, ef_construction=64)
--   • metadata JSONB with no GIN index in v1; add one if query patterns emerge
--   • No updated_at trigger in v1; documents are append-only under worker model
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------
-- prior_art_documents
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prior_art_documents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     TEXT        NOT NULL CHECK (source_id <> ''),
  native_id     TEXT        NOT NULL CHECK (native_id <> ''),
  doc_type      TEXT        NOT NULL CHECK (doc_type <> ''),
  title         TEXT        NOT NULL,
  abstract      TEXT,
  url           TEXT,
  published_at  TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  language      TEXT        NOT NULL DEFAULT 'en',
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  embedding     vector(1536)
);

-- Upsert key for ingestion workers. The leading source_id column also
-- satisfies filter-by-source queries, so no separate source_id index is
-- created — adding one would be redundant and cost write performance.
CREATE UNIQUE INDEX IF NOT EXISTS prior_art_documents_source_native_uniq
  ON prior_art_documents (source_id, native_id);

-- Cosine-similarity ANN search on embeddings.
CREATE INDEX IF NOT EXISTS prior_art_documents_embedding_hnsw
  ON prior_art_documents
  USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------
-- source_ingestion_log
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_ingestion_log (
  id             BIGSERIAL   PRIMARY KEY,
  source_id      TEXT        NOT NULL CHECK (source_id <> ''),
  mode           TEXT        NOT NULL CHECK (mode IN ('backfill', 'delta')),
  status         TEXT        NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  docs_ingested  INTEGER     NOT NULL DEFAULT 0,
  docs_skipped   INTEGER     NOT NULL DEFAULT 0,
  error          TEXT,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- Serves "most recent run per source" and "all runs for source X" lookups.
CREATE INDEX IF NOT EXISTS source_ingestion_log_source_started_idx
  ON source_ingestion_log (source_id, started_at DESC);

-- ---------------------------------------------------------------------
-- migrations_applied
--   Also created idempotently by run_migrations.js on startup, but declared
--   here so a fresh database initialized purely via psql < 001_init.sql is
--   in a consistent state.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migrations_applied (
  id          SERIAL      PRIMARY KEY,
  name        TEXT        NOT NULL UNIQUE,
  checksum    TEXT        NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
