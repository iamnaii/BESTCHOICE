-- F25: JournalLine.journalEntry onDelete Cascade -> Restrict.
-- Journal lines are legal accounting evidence; a hard delete of a JournalEntry
-- must never silently cascade-wipe its lines. Aligns with the v3 "Restrict on
-- financial/evidence tables" policy. No rows are cascade-deleted today (the path
-- is unreachable: JournalPostAuditLog has a Restrict FK and all code soft-deletes),
-- so this swap is non-destructive.
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_journal_entry_id_fkey";
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- B13: compound index for the hot read path `where: { journalEntryId, deletedAt: null }`
-- (journal-auto.service line reads). Existing single-column index on journal_entry_id
-- forces a heap filter on deleted_at; this pushes both predicates into the index.
CREATE INDEX IF NOT EXISTS "journal_lines_journal_entry_id_deleted_at_idx" ON "journal_lines"("journal_entry_id", "deleted_at");
