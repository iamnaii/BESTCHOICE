-- T2-C7: Data audit acknowledgement flow. Failed checks need an accountant
-- to explicitly mark "I looked at this" — 24h SLA enforced by escalation
-- cron. Optional notes field captures the resolution or next step.

ALTER TABLE "data_audit_logs"
  ADD COLUMN "acknowledged_at"    TIMESTAMP(3),
  ADD COLUMN "acknowledged_by_id" TEXT,
  ADD COLUMN "acknowledge_notes"  TEXT;

CREATE INDEX "data_audit_logs_status_acknowledged_at_idx"
  ON "data_audit_logs"("status", "acknowledged_at");

ALTER TABLE "data_audit_logs"
  ADD CONSTRAINT "data_audit_logs_acknowledged_by_id_fkey"
  FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
