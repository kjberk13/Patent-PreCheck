-- =====================================================================
-- Patent PreCheck — migration 003: resize embedding columns to 1024 dims
--
-- Context: Voyage's voyage-3-large uses Matryoshka Representation
-- Learning and only accepts output_dimension ∈ {256, 512, 1024, 2048}.
-- Our initial schema used vector(1536) (OpenAI's convention) which
-- Voyage rejects at request time with:
--   "output_dimension is not valid, supported values are
--    256, 512, 1024, 2048"
--
-- We standardise on 1024:
--   • voyage-3-large @ 1024 is within 0.31% of @ 2048 in retrieval
--     benchmarks (Voyage's published numbers)
--   • 1024 is Voyage's documented default
--   • 33% smaller vectors than 1536 → cheaper Neon storage, faster
--     HNSW scans
--   • OpenAI text-embedding-3-small supports dimensions=1024 natively
--     via its Matryoshka-compatible API, so the fallback still works
--
-- Safety: no production data to preserve. prior_art_documents and
-- embedding_cache are both empty at deploy time (Phase 2.6.1 smoke
-- backfill hasn't run yet). TRUNCATE before DROP COLUMN is belt-and-
-- suspenders for any stray dev rows — the column-type change alone
-- would fail on a non-empty table with NOT NULL constraints.
-- =====================================================================

-- ---------------------------------------------------------------------
-- prior_art_documents: vector(1536) → vector(1024), rebuild HNSW
-- ---------------------------------------------------------------------

TRUNCATE TABLE prior_art_documents;

DROP INDEX IF EXISTS prior_art_documents_embedding_hnsw;

ALTER TABLE prior_art_documents DROP COLUMN embedding;

ALTER TABLE prior_art_documents ADD COLUMN embedding vector(1024);

-- Same HNSW parameters as migration 001 (m=16, ef_construction=64
-- defaults from pgvector 0.6). Retunable later with a REINDEX.
CREATE INDEX IF NOT EXISTS prior_art_documents_embedding_hnsw
  ON prior_art_documents
  USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------
-- embedding_cache: vector(1536) → vector(1024)
-- The cache has no HNSW index (keyed lookup via cache_key UNIQUE), so
-- only the column itself needs resizing.
-- ---------------------------------------------------------------------

TRUNCATE TABLE embedding_cache;

ALTER TABLE embedding_cache DROP COLUMN embedding;

ALTER TABLE embedding_cache ADD COLUMN embedding vector(1024) NOT NULL;
