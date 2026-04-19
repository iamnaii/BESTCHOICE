-- T2-C14: Immutable audit log of every DRAFT→POSTED transition on a
-- journal entry. Written in the same $transaction as the post() update
-- so a failed audit insert rolls the post back.

CREATE TABLE "journal_post_audit_logs" (
  "id"               TEXT NOT NULL,
  "journal_entry_id" TEXT NOT NULL,
  "posted_by_id"     TEXT NOT NULL,
  "posted_at"        TIMESTAMP(3) NOT NULL,
  "ip_address"       TEXT,
  "user_agent"       TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_post_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "journal_post_audit_logs_journal_entry_id_idx"
  ON "journal_post_audit_logs"("journal_entry_id");
CREATE INDEX "journal_post_audit_logs_posted_by_id_idx"
  ON "journal_post_audit_logs"("posted_by_id");
CREATE INDEX "journal_post_audit_logs_posted_at_idx"
  ON "journal_post_audit_logs"("posted_at");

ALTER TABLE "journal_post_audit_logs"
  ADD CONSTRAINT "journal_post_audit_logs_journal_entry_id_fkey"
  FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
