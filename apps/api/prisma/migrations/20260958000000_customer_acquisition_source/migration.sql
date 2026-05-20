-- Phase A SHOP Sales AI: track which channel produced each lead
-- (e.g. "line-shop", "facebook", "tiktok", "walk-in"). Nullable so existing
-- rows remain valid; new AI-captured leads stamp this on insert.
-- AlterTable
ALTER TABLE "customers"
  ADD COLUMN "acquisition_source" TEXT;

-- CreateIndex
CREATE INDEX "customers_acquisition_source_idx" ON "customers"("acquisition_source");
