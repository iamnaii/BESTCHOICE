-- Fixed Asset Management + Depreciation

CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');

CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "asset_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "branch_id" TEXT,
    "cost_value" DECIMAL(12,2) NOT NULL,
    "salvage_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "useful_life" INTEGER NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "accumulated_depre" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "disposed_at" TIMESTAMP(3),
    "disposal_note" TEXT,
    "depreciation_account_code" TEXT NOT NULL DEFAULT '53-1601',
    "accumulated_account_code" TEXT NOT NULL DEFAULT '12-2102',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fixed_assets_asset_code_key" ON "fixed_assets"("asset_code");
CREATE INDEX "fixed_assets_branch_id_idx" ON "fixed_assets"("branch_id");
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets"("status");
CREATE INDEX "fixed_assets_category_idx" ON "fixed_assets"("category");
CREATE INDEX "fixed_assets_purchase_date_idx" ON "fixed_assets"("purchase_date");

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
