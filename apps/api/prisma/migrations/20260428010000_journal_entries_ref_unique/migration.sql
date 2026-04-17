-- Enforce one-journal-per-source for auto-generated entries.
-- MANUAL entries (reference_type IS NULL) remain unconstrained.
-- Composite covers both columns to prevent duplicate-posting races
-- (e.g., createPaymentJournal retried after a swallowed exception).

CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_ref_unique"
  ON "journal_entries"("reference_type", "reference_id")
  WHERE "reference_type" IS NOT NULL
    AND "reference_id" IS NOT NULL
    AND "deleted_at" IS NULL;
