-- =====================================================================
-- Patent PreCheck — migration 004: code review signups + evidence
--
-- Creates the persistence layer for the paid Interactive Code Review
-- tier (Phase 2.7). Two tables:
--
--   code_review_signups   — one row per paid-tier signup. Holds the
--                           contact PII collected on /review-signup.html,
--                           plus session state (JSONB), the SHA-256 hash
--                           of the user's code/invention input (NOT the
--                           raw content — see PRIVACY_TERMS.md), and
--                           the dual-PDF report URLs (populated by
--                           Commit 4's PDF generation).
--
--   code_review_evidence  — one row per supporting document the user
--                           uploads during the interactive Q&A. Stores
--                           ONLY metadata + Claude-extracted structured
--                           evidence; original files are read once for
--                           extraction and immediately discarded per
--                           the Option C policy locked in
--                           FEATURES_STATE.md (Evidence upload section).
--
-- Field naming reflects the Commit 1 product-feedback rename:
--   address_*           — user's mailing address (was formal_address_*)
--   billing_*           — billing address (was business_address_*)
--   business_name       — optional, nullable (was not present)
--   billing_same_as_address — toggle (was business_address_same_as_formal)
-- =====================================================================

-- ---------------------------------------------------------------------
-- code_review_signups
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS code_review_signups (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_name                  TEXT        NOT NULL,
  last_name                   TEXT        NOT NULL,
  business_name               TEXT,
  email                       TEXT        NOT NULL,
  phone                       TEXT        NOT NULL,
  address_line1               TEXT        NOT NULL,
  address_line2               TEXT,
  address_city                TEXT        NOT NULL,
  address_state               TEXT        NOT NULL,
  address_zip                 TEXT        NOT NULL,
  address_country             TEXT        NOT NULL DEFAULT 'US',
  billing_same_as_address     BOOLEAN     NOT NULL DEFAULT FALSE,
  billing_line1               TEXT,
  billing_line2               TEXT,
  billing_city                TEXT,
  billing_state               TEXT,
  billing_zip                 TEXT,
  billing_country             TEXT        DEFAULT 'US',
  access_method               TEXT        NOT NULL CHECK (access_method IN ('beta_bypass', 'stripe_payment')),
  access_token_used           TEXT,
  input_hash                  TEXT        NOT NULL,
  input_length                INTEGER     NOT NULL,
  report_id                   TEXT        NOT NULL UNIQUE,
  idf_pdf_url                 TEXT,
  application_pdf_url         TEXT,
  session_state               JSONB,
  session_completed_at        TIMESTAMPTZ,
  created_ip                  TEXT,
  user_agent                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_code_review_signups_email
  ON code_review_signups (email);
CREATE INDEX IF NOT EXISTS idx_code_review_signups_created_at
  ON code_review_signups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_code_review_signups_report_id
  ON code_review_signups (report_id);

-- ---------------------------------------------------------------------
-- code_review_evidence
-- We never store original files — this table stores ONLY metadata and
-- Claude-extracted structured evidence (the JSONB column). Per the
-- "Option C" policy in FEATURES_STATE.md → Evidence upload capability →
-- Storage policy. The UI surfaces this clearly to users at upload time
-- ("Keep your own copy — we don't store originals").
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS code_review_evidence (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id              UUID        NOT NULL REFERENCES code_review_signups(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filename               TEXT        NOT NULL,
  file_type              TEXT        NOT NULL,
  file_size_bytes        INTEGER,
  upload_timestamp       TIMESTAMPTZ NOT NULL,
  claimed_document_date  DATE,
  user_description       TEXT,
  category               TEXT        NOT NULL CHECK (category IN ('problem_framing', 'constraints', 'conception_moment', 'decision_record')),
  extracted_evidence     JSONB       NOT NULL,
  supports_claim         BOOLEAN     NOT NULL,
  score_contribution     INTEGER     DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_code_review_evidence_signup
  ON code_review_evidence (signup_id);
CREATE INDEX IF NOT EXISTS idx_code_review_evidence_category
  ON code_review_evidence (category);
