-- =====================================================================
-- 005_code_review_signups_paste_input.sql
--
-- PR-B: Carry code forward from /analyze.html to /review-signup.html.
--
-- The signup form now includes a `paste_input` field — the actual code
-- or invention text the user wants reviewed. Stored alongside the
-- existing analyze-time `input_hash` / `input_length` columns so the
-- live content and the original analyze-time fingerprint can both be
-- retained on the same row.
--
-- Nullable: the column is added without a default so existing rows
-- created before PR-B remain untouched.
-- =====================================================================

ALTER TABLE code_review_signups
  ADD COLUMN IF NOT EXISTS paste_input TEXT;
