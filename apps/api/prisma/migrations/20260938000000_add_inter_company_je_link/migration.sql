-- SP2: Link InterCompanyTransaction → JournalEntry so settle() can post a real JE
-- and the txn record points back to the JE that cleared it.
--
-- nullable + ON DELETE SET NULL: settling JEs may be voided later without losing
-- the IC txn row (the row will simply revert to status=PENDING during a manual
-- corrective workflow).

ALTER TABLE "inter_company_transactions"
  ADD COLUMN "journal_entry_id" TEXT NULL;

ALTER TABLE "inter_company_transactions"
  ADD CONSTRAINT "inter_company_transactions_journal_entry_id_fkey"
  FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "inter_company_transactions_journal_entry_id_idx"
  ON "inter_company_transactions" ("journal_entry_id");
