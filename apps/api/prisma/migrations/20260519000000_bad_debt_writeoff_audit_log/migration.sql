-- T1-C7: Immutable audit trail for bad-debt write-offs.
-- The global AuditInterceptor already logs write-offs but rotates on 180-day
-- retention. Thai Revenue Code requires write-off evidence retained 7+ years.
-- Dedicated table + BEFORE DELETE trigger = append-only forensic record.

CREATE TABLE "bad_debt_write_off_audit_logs" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "contract_number" TEXT NOT NULL,
    "outstanding_amount" DECIMAL(12,2) NOT NULL,
    "provision_amount" DECIMAL(12,2) NOT NULL,
    "written_off_by_id" TEXT NOT NULL,
    "written_off_by_role" TEXT NOT NULL,
    "approved_by_id" TEXT NOT NULL,
    "approved_by_role" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bad_debt_write_off_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bad_debt_write_off_audit_logs_contract_id_idx" ON "bad_debt_write_off_audit_logs"("contract_id");
CREATE INDEX "bad_debt_write_off_audit_logs_written_off_by_id_created_at_idx" ON "bad_debt_write_off_audit_logs"("written_off_by_id", "created_at");
CREATE INDEX "bad_debt_write_off_audit_logs_approved_by_id_created_at_idx" ON "bad_debt_write_off_audit_logs"("approved_by_id", "created_at");
CREATE INDEX "bad_debt_write_off_audit_logs_created_at_idx" ON "bad_debt_write_off_audit_logs"("created_at");

ALTER TABLE "bad_debt_write_off_audit_logs"
  ADD CONSTRAINT "bad_debt_write_off_audit_logs_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bad_debt_write_off_audit_logs"
  ADD CONSTRAINT "bad_debt_write_off_audit_logs_written_off_by_id_fkey"
  FOREIGN KEY ("written_off_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bad_debt_write_off_audit_logs"
  ADD CONSTRAINT "bad_debt_write_off_audit_logs_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Block physical DELETE at the DB level. Matches the pattern used for
-- audit_logs (see migration 20260520300000_audit_log_archive_immutable).
-- Any code path (ORM, raw SQL, migration) that attempts DELETE will raise.
CREATE OR REPLACE FUNCTION bad_debt_write_off_audit_logs_block_delete()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'DELETE forbidden on bad_debt_write_off_audit_logs — immutable audit trail (T1-C7)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bad_debt_write_off_audit_logs_no_delete
  BEFORE DELETE ON "bad_debt_write_off_audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION bad_debt_write_off_audit_logs_block_delete();
