-- Phase 3 SP2 — Off-site backup replication run log
--
-- One row per cron tick (hourly default 03:30 BKK) or manual trigger.
-- Append-only operational history; UI surfaces the last 30 rows.
--
-- IF NOT EXISTS guards are used so a re-run of `migrate deploy` on an
-- environment that already applied this migration is a safe no-op.

DO $$ BEGIN
  CREATE TYPE "OffsiteBackupStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "offsite_backup_runs" (
  "id"             TEXT NOT NULL,
  "started_at"     TIMESTAMP(3) NOT NULL,
  "finished_at"    TIMESTAMP(3),
  "status"         "OffsiteBackupStatus" NOT NULL,
  "files_count"    INTEGER NOT NULL DEFAULT 0,
  "total_bytes"    BIGINT NOT NULL DEFAULT 0,
  "error_message"  TEXT,
  "triggered_by"   TEXT,
  "dest_bucket"    TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "offsite_backup_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "offsite_backup_runs_started_at_idx"
  ON "offsite_backup_runs"("started_at");
