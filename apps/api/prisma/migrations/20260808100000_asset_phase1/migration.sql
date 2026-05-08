-- Phase 1 — FixedAsset schema redesign
-- Replaces minimal Phase A.5c schema with full DRAFT/POSTED/REVERSED workflow + VAT/WHT/vendor.
-- Matches docs/superpowers/specs/2026-05-08-asset-module-phase1-design.md
--
-- Pre-condition: production-side wipe (truncate fixed_assets + depreciation_entries) before
-- running this migration in environments with existing rows. New NOT NULL columns
-- (doc_no, base_price, purchase_cost, monthly_depr, net_book_value, useful_life_months,
-- created_by_id) cannot be backfilled mechanically.

-- Pre-condition guard: Phase 1 migration assumes fixed_assets is empty
-- (production deploys must run wipe-assets CLI first; see plan Task 2).
-- If any rows exist, abort the migration before destructive ops begin.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM fixed_assets) > 0 THEN
    RAISE EXCEPTION 'Refusing to run asset_phase1 migration: fixed_assets must be empty (run wipe:assets CLI first). Found % rows.', (SELECT COUNT(*) FROM fixed_assets);
  END IF;
END $$;

-- =============================================================================
-- Step 1: Rename AssetCategory enum values
-- (PG 13+ supports ALTER TYPE ... RENAME VALUE)
-- =============================================================================
ALTER TYPE "AssetCategory" RENAME VALUE 'OFFICE_EQUIPMENT' TO 'EQUIPMENT';
ALTER TYPE "AssetCategory" RENAME VALUE 'BUILDING_IMPROVEMENT' TO 'IMPROVEMENT';
ALTER TYPE "AssetCategory" RENAME VALUE 'OFFICE_FURNITURE' TO 'FURNITURE';
-- VEHICLE unchanged

-- =============================================================================
-- Step 2: Replace AssetStatus enum (drop ACTIVE/FULLY_DEPRECIATED, add DRAFT/POSTED/REVERSED)
-- New values: DRAFT, POSTED, REVERSED, DISPOSED, WRITTEN_OFF
-- Drop default first so the column can be retyped, then re-add with new default.
-- =============================================================================
ALTER TABLE "fixed_assets" ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "AssetStatus_new" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'DISPOSED', 'WRITTEN_OFF');

-- Map legacy values: ACTIVE → DRAFT, FULLY_DEPRECIATED → POSTED (best-effort; production
-- expected to be empty per spec § Migration plan).
ALTER TABLE "fixed_assets"
  ALTER COLUMN "status" TYPE "AssetStatus_new"
  USING (
    CASE "status"::text
      WHEN 'ACTIVE' THEN 'DRAFT'
      WHEN 'FULLY_DEPRECIATED' THEN 'POSTED'
      ELSE "status"::text
    END
  )::"AssetStatus_new";

DROP TYPE "AssetStatus";
ALTER TYPE "AssetStatus_new" RENAME TO "AssetStatus";

ALTER TABLE "fixed_assets" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- =============================================================================
-- Step 3: Drop legacy columns from fixed_assets
-- =============================================================================
ALTER TABLE "fixed_assets" DROP CONSTRAINT IF EXISTS "fixed_assets_created_by_id_fkey";

DROP INDEX IF EXISTS "fixed_assets_asset_category_status_idx";
DROP INDEX IF EXISTS "fixed_assets_category_idx";

ALTER TABLE "fixed_assets"
  DROP COLUMN IF EXISTS "asset_category",
  DROP COLUMN IF EXISTS "cost_value",
  DROP COLUMN IF EXISTS "salvage_value",
  DROP COLUMN IF EXISTS "useful_life",
  DROP COLUMN IF EXISTS "useful_life_months",
  DROP COLUMN IF EXISTS "accumulated_depre",
  DROP COLUMN IF EXISTS "disposed_at",
  DROP COLUMN IF EXISTS "disposal_note",
  DROP COLUMN IF EXISTS "disposal_proceeds",
  DROP COLUMN IF EXISTS "last_depreciation_period",
  DROP COLUMN IF EXISTS "depreciation_account_code",
  DROP COLUMN IF EXISTS "accumulated_account_code";

-- =============================================================================
-- Step 4: Convert legacy free-form `category` (TEXT?) to enum AssetCategory NOT NULL
-- =============================================================================
ALTER TABLE "fixed_assets" DROP COLUMN "category";
ALTER TABLE "fixed_assets" ADD COLUMN "category" "AssetCategory" NOT NULL;

-- =============================================================================
-- Step 5: Add new columns
-- =============================================================================
ALTER TABLE "fixed_assets"
  ADD COLUMN "doc_no" TEXT NOT NULL,
  ADD COLUMN "base_price" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "shipping_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "installation_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "other_capitalized" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "has_vat" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vat_inclusive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "vat_account" TEXT,
  ADD COLUMN "has_wht" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "wht_base_amount" DECIMAL(12,2),
  ADD COLUMN "wht_rate" DECIMAL(5,4),
  ADD COLUMN "wht_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "wht_account" TEXT,
  ADD COLUMN "wht_form_type" TEXT,
  ADD COLUMN "purchase_cost" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "residual_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "useful_life_months" INTEGER NOT NULL,
  ADD COLUMN "monthly_depr" DECIMAL(12,4) NOT NULL,
  ADD COLUMN "accumulated_depr" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "net_book_value" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "coa_cost_account" TEXT,
  ADD COLUMN "coa_depr_account" TEXT,
  ADD COLUMN "coa_expense_account" TEXT,
  ADD COLUMN "invoice_date" TIMESTAMP(3),
  ADD COLUMN "disposal_date" TIMESTAMP(3),
  ADD COLUMN "warranty_expire" TIMESTAMP(3),
  ADD COLUMN "supplier_name" TEXT,
  ADD COLUMN "supplier_tax_id" TEXT,
  ADD COLUMN "invoice_no" TEXT,
  ADD COLUMN "tax_invoice_no" TEXT,
  ADD COLUMN "payment_method" "PaymentMethod",
  ADD COLUMN "payment_account" TEXT,
  ADD COLUMN "custodian" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "serial_no" TEXT,
  ADD COLUMN "pr_ref" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "is_overridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approver_id" TEXT,
  ADD COLUMN "posted_by_id" TEXT,
  ADD COLUMN "posted_at" TIMESTAMP(3),
  ADD COLUMN "reversed_by_id" TEXT,
  ADD COLUMN "reversed_at" TIMESTAMP(3),
  ADD COLUMN "reversal_reason" TEXT;

-- created_by_id was nullable; flip to NOT NULL (no rows expected per spec wipe)
ALTER TABLE "fixed_assets" ALTER COLUMN "created_by_id" SET NOT NULL;

-- =============================================================================
-- Step 6: Indexes
-- =============================================================================
CREATE UNIQUE INDEX "fixed_assets_doc_no_key" ON "fixed_assets" ("doc_no");
CREATE INDEX "fixed_assets_category_status_idx" ON "fixed_assets" ("category", "status");

-- =============================================================================
-- Step 7: Foreign keys for new audit relations + restore created_by_id FK
-- =============================================================================
ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_approver_id_fkey"
    FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_posted_by_id_fkey"
    FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_reversed_by_id_fkey"
    FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Step 8: AssetTransferHistory table
-- =============================================================================
CREATE TABLE "asset_transfer_history" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "transfer_date" TIMESTAMP(3) NOT NULL,
    "from_custodian" TEXT,
    "to_custodian" TEXT,
    "from_location" TEXT,
    "to_location" TEXT,
    "reason" TEXT NOT NULL,
    "transferred_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_transfer_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_transfer_history_transfer_id_key" ON "asset_transfer_history" ("transfer_id");
CREATE INDEX "asset_transfer_history_asset_id_transfer_date_idx" ON "asset_transfer_history" ("asset_id", "transfer_date");

ALTER TABLE "asset_transfer_history"
  ADD CONSTRAINT "asset_transfer_history_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_transfer_history"
  ADD CONSTRAINT "asset_transfer_history_transferred_by_id_fkey"
    FOREIGN KEY ("transferred_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
