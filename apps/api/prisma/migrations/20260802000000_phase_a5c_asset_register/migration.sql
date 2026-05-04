-- Phase A.5c Wave 1 — PPE infrastructure
-- Adds AssetCategory enum, WRITTEN_OFF to AssetStatus, extends FixedAsset,
-- and creates DepreciationEntry idempotency table.

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('OFFICE_EQUIPMENT', 'BUILDING_IMPROVEMENT', 'OFFICE_FURNITURE', 'VEHICLE');

-- AlterEnum: add WRITTEN_OFF to AssetStatus
ALTER TYPE "AssetStatus" ADD VALUE 'WRITTEN_OFF';

-- AlterTable fixed_assets
ALTER TABLE "fixed_assets"
  ADD COLUMN "asset_category" "AssetCategory",
  ADD COLUMN "disposal_proceeds" DECIMAL(12,2),
  ADD COLUMN "last_depreciation_period" TEXT,
  ADD COLUMN "useful_life_months" INTEGER;

-- CreateTable depreciation_entries
CREATE TABLE "depreciation_entries" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "journal_entry_no" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "depreciation_entries_period_idx" ON "depreciation_entries"("period");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_entries_asset_id_period_key" ON "depreciation_entries"("asset_id", "period");

-- CreateIndex
CREATE INDEX "fixed_assets_asset_category_status_idx" ON "fixed_assets"("asset_category", "status");

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
