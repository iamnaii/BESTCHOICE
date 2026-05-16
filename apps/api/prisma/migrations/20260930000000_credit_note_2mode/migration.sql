-- C4 · Credit Note 2-Mode
-- Adds an explicit mode discriminator on credit_note_details and makes
-- original_document_id nullable so STANDALONE credit notes (no source EX)
-- can be issued — e.g. supplier refund without original invoice.

-- Step 1: enum for the mode
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CreditNoteMode') THEN
    CREATE TYPE "CreditNoteMode" AS ENUM ('LINKED', 'STANDALONE');
  END IF;
END $$;

-- Step 2: add mode column with default LINKED so existing rows backfill
ALTER TABLE "credit_note_details"
  ADD COLUMN IF NOT EXISTS "mode" "CreditNoteMode" NOT NULL DEFAULT 'LINKED';

-- Step 3: relax original_document_id to nullable. The FK constraint already has
-- ON DELETE RESTRICT — that protection still applies when the column is set.
ALTER TABLE "credit_note_details"
  ALTER COLUMN "original_document_id" DROP NOT NULL;
