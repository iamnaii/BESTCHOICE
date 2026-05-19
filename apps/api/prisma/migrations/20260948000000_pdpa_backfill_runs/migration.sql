-- Phase 3 SP4 — PDPA PII encryption infrastructure
-- Adds:
--   1. PdpaBackfillRun table — append-only event log for backfill runs
--   2. Column comments on legacy plaintext PII columns flagging them for
--      eventual drop after the strict-mode stability window (Phase 6.6).
--
-- The Customer.*Encrypted + *Hash columns themselves were created by an
-- earlier migration (20260528400000_add_pii_encrypted_columns). This migration
-- is purely additive — no existing column is altered, no constraint is removed.
-- Every statement uses IF NOT EXISTS so the migration is idempotent and safe
-- to re-run against environments that already have parts of it.

-- =============================================================================
-- 1. PdpaBackfillRun table
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'PdpaBackfillStatus'
  ) THEN
    CREATE TYPE "PdpaBackfillStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "pdpa_backfill_runs" (
  "id"                  TEXT NOT NULL,
  "status"              "PdpaBackfillStatus" NOT NULL,
  "total_records"       INTEGER NOT NULL DEFAULT 0,
  "processed_records"   INTEGER NOT NULL DEFAULT 0,
  "skipped_records"     INTEGER NOT NULL DEFAULT 0,
  "started_at"          TIMESTAMP(3) NOT NULL,
  "finished_at"         TIMESTAMP(3),
  "error_message"       TEXT,
  "triggered_by"        TEXT NOT NULL DEFAULT 'cli',
  "triggered_by_user_id" TEXT,
  "hostname"            TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pdpa_backfill_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pdpa_backfill_runs_started_at_idx"
  ON "pdpa_backfill_runs" ("started_at");
CREATE INDEX IF NOT EXISTS "pdpa_backfill_runs_triggered_by_user_id_idx"
  ON "pdpa_backfill_runs" ("triggered_by_user_id");
CREATE INDEX IF NOT EXISTS "pdpa_backfill_runs_status_idx"
  ON "pdpa_backfill_runs" ("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pdpa_backfill_runs_triggered_by_user_id_fkey'
  ) THEN
    ALTER TABLE "pdpa_backfill_runs"
      ADD CONSTRAINT "pdpa_backfill_runs_triggered_by_user_id_fkey"
      FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- =============================================================================
-- 2. Column comments on legacy plaintext PII columns (Phase 6.6 will drop them)
-- =============================================================================
-- These comments make the deprecation status discoverable via psql \d+ or any
-- DB GUI without having to grep through the schema file.

COMMENT ON COLUMN "customers"."national_id" IS
  'LEGACY plaintext PII — use national_id_encrypted + national_id_hash. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."phone" IS
  'LEGACY plaintext PII — use phone_encrypted + phone_hash. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."phone_secondary" IS
  'LEGACY plaintext PII — use phone_secondary_encrypted. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."email" IS
  'LEGACY plaintext PII — use email_encrypted. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."address_id_card" IS
  'LEGACY plaintext PII — use address_id_card_encrypted. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."address_current" IS
  'LEGACY plaintext PII — use address_current_encrypted. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."address_work" IS
  'LEGACY plaintext PII — use address_work_encrypted. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."guardian_national_id" IS
  'LEGACY plaintext PII — use guardian_national_id_encrypted. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."guardian_phone" IS
  'LEGACY plaintext PII — use guardian_phone_encrypted. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."guardian_address" IS
  'LEGACY plaintext PII — use guardian_address_encrypted. Cleared in Phase 6.6.';
COMMENT ON COLUMN "customers"."references" IS
  'LEGACY plaintext PII JSON — use references_encrypted. Cleared in Phase 6.6.';
