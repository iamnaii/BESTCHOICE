-- Phase 2 — DepreciationEntry reverse-run tracking
-- Adds nullable reversedAt + reversedById FK + compound index on (period, reversedAt).
-- Non-destructive: all additions are nullable, so no backfill needed.

-- AlterTable
ALTER TABLE "depreciation_entries" ADD COLUMN "reversed_at" TIMESTAMP(3);
ALTER TABLE "depreciation_entries" ADD COLUMN "reversed_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "depreciation_entries_period_reversed_at_idx" ON "depreciation_entries"("period", "reversed_at");
