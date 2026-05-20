-- Tighten acquisition_source column: bound type + partial index for non-null filter queries.
-- Phase A: low-cardinality field with mostly NULL legacy rows; partial index keeps
-- the AI-lead filter queries fast without indexing the bulk of legacy data.

-- AlterTable
ALTER TABLE "customers" ALTER COLUMN "acquisition_source" TYPE VARCHAR(50);

-- DropIndex (full B-tree from migration 20260958)
DROP INDEX IF EXISTS "customers_acquisition_source_idx";

-- CreateIndex (partial — excludes large NULL population)
CREATE INDEX "customers_acquisition_source_active_idx"
  ON "customers"("acquisition_source")
  WHERE "acquisition_source" IS NOT NULL;
