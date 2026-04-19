-- T2-C4 — Make audit_logs effectively immutable.
--
-- Before: cron hard-deleted rows older than 1 year (violates Thai Revenue
-- Code retention requirements and lets an insider with DB access erase
-- forensic evidence).
--
-- After:
--   1. A nullable `archived_at` column replaces delete with soft-archive.
--   2. A BEFORE DELETE trigger rejects any DELETE statement on this table —
--      no user / role can remove rows, whether via ORM, migration,
--      or raw SQL, unless they first `ALTER TABLE ... DISABLE TRIGGER`.
--   3. Retention is now 7 years (Thai business records standard), enforced
--      by the scheduler cron which sets archived_at instead of deleting.

-- 1. Add soft-archive column
ALTER TABLE "audit_logs" ADD COLUMN "archived_at" TIMESTAMP(3);
CREATE INDEX "audit_logs_archived_at_idx" ON "audit_logs"("archived_at");

-- 2. Block DELETE on audit_logs
CREATE OR REPLACE FUNCTION audit_logs_block_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable — DELETE is not allowed (T2-C4). Use archived_at to soft-archive instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_delete ON "audit_logs";
CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION audit_logs_block_delete();
