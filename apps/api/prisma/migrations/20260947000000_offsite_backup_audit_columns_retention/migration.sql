-- Phase 3 SP2 — DEEP review fixes (C2 + C3)
--
-- C2: split triggered_by into category + nullable FK to users(id).
--     Previously raw UUIDs were stored in `triggered_by` with no FK —
--     orphans survived user soft-delete and the UI showed `user:abcd1234`.
-- C3: add /// retention comment + daily retention cron (added in code).
--
-- IF NOT EXISTS / DO $$ guards make this migration idempotent — safe to
-- re-run after a partial failure or on environments that already applied.

-- 1) Add nullable FK column (idempotent).
ALTER TABLE "offsite_backup_runs"
  ADD COLUMN IF NOT EXISTS "triggered_by_user_id" UUID;

-- 2) Backfill: normalize triggered_by values.
--    Anything that is NOT one of the two known categories ('cron'|'manual')
--    is assumed to be a stray user UUID written by the pre-fix code. Move
--    it into triggered_by_user_id (best-effort — invalid UUIDs silently
--    skipped) and reset triggered_by to 'manual'. Defaults
--    `triggered_by IS NULL` to 'cron' so existing rows always have a value.
DO $$
BEGIN
  -- Migrate stray UUIDs from triggered_by → triggered_by_user_id.
  UPDATE "offsite_backup_runs"
  SET "triggered_by_user_id" = "triggered_by"::uuid
  WHERE "triggered_by" IS NOT NULL
    AND "triggered_by" NOT IN ('cron', 'manual')
    AND "triggered_by" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS (SELECT 1 FROM "users" WHERE "users"."id"::text = "offsite_backup_runs"."triggered_by");
EXCEPTION WHEN OTHERS THEN
  -- Defensive: any cast failure should not break the migration.
  NULL;
END $$;

-- Normalize category column. Anything that isn't 'cron' is treated as
-- a manual trigger (whether the UUID matched a real user or not — the
-- audit log still has it via the FK column or audit_logs.userId).
UPDATE "offsite_backup_runs"
SET "triggered_by" = 'manual'
WHERE "triggered_by" IS NULL
   OR "triggered_by" NOT IN ('cron', 'manual');

-- 3) Tighten the column: NOT NULL + default 'cron'.
ALTER TABLE "offsite_backup_runs"
  ALTER COLUMN "triggered_by" SET NOT NULL,
  ALTER COLUMN "triggered_by" SET DEFAULT 'cron';

-- 4) Add FK constraint + index (idempotent via DO blocks).
DO $$ BEGIN
  ALTER TABLE "offsite_backup_runs"
    ADD CONSTRAINT "offsite_backup_runs_triggered_by_user_id_fkey"
    FOREIGN KEY ("triggered_by_user_id")
    REFERENCES "users"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "offsite_backup_runs_triggered_by_user_id_idx"
  ON "offsite_backup_runs"("triggered_by_user_id");
