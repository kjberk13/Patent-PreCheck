-- =====================================================================
-- Patent PreCheck — migration 002: embedding cache
--
-- Memoizes (model, normalized_text) -> embedding so identical inputs are
-- not re-embedded across worker runs or across overlapping sources. Sized
-- around an expected backfill of millions of rows; LRU eviction is deferred
-- (last_used_at supports it when we need it).
-- =====================================================================

CREATE TABLE IF NOT EXISTS embedding_cache (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key     TEXT         NOT NULL UNIQUE,
  model         TEXT         NOT NULL,
  embedding     vector(1536) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Supports future LRU eviction via "DELETE ... ORDER BY last_used_at LIMIT N".
CREATE INDEX IF NOT EXISTS idx_embedding_cache_last_used
  ON embedding_cache (last_used_at);
