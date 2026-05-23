-- Phase A: Installment Calculator preview — additive only, no breaking changes
-- Adds: cashPrice/installmentPrice on products, GFIN tables, InterestConfigRate

-- AlterTable: add cash_price and installment_price nullable columns on products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cash_price" DECIMAL(12,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "installment_price" DECIMAL(12,2);

-- CreateEnum: gfin_condition
CREATE TYPE "gfin_condition" AS ENUM ('HAND_1', 'HAND_2');

-- CreateTable: gfin_model_mappings
CREATE TABLE "gfin_model_mappings" (
    "id" TEXT NOT NULL,
    "gfin_series" TEXT NOT NULL,
    "gfin_variant" TEXT,
    "storage" TEXT NOT NULL,
    "condition" "gfin_condition" NOT NULL,
    "max_price" DECIMAL(12,2) NOT NULL,
    "model_match_pattern" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gfin_model_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: gfin_overprice_rules
CREATE TABLE "gfin_overprice_rules" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "series_pattern" TEXT NOT NULL,
    "condition" "gfin_condition" NOT NULL,
    "allowance" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gfin_overprice_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: gfin_rate_factors
CREATE TABLE "gfin_rate_factors" (
    "id" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "factor" DECIMAL(8,6) NOT NULL,
    "fee_per_installment" DECIMAL(12,2) NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gfin_rate_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable: interest_config_rates
CREATE TABLE "interest_config_rates" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "rate_pct" DECIMAL(5,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "interest_config_rates_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex: gfin_model_mappings (gfinSeries, gfinVariant, storage, condition)
CREATE UNIQUE INDEX "gfin_model_mappings_gfin_series_gfin_variant_storage_condition_key" ON "gfin_model_mappings"("gfin_series", "gfin_variant", "storage", "condition");

-- CreateIndex: gfin_model_mappings model_match_pattern
CREATE INDEX "gfin_model_mappings_model_match_pattern_idx" ON "gfin_model_mappings"("model_match_pattern");

-- CreateIndex: gfin_overprice_rules (condition, is_active)
CREATE INDEX "gfin_overprice_rules_condition_is_active_idx" ON "gfin_overprice_rules"("condition", "is_active");

-- CreateUniqueIndex: gfin_rate_factors months
CREATE UNIQUE INDEX "gfin_rate_factors_months_key" ON "gfin_rate_factors"("months");

-- CreateUniqueIndex: interest_config_rates (config_id, months)
CREATE UNIQUE INDEX "interest_config_rates_config_id_months_key" ON "interest_config_rates"("config_id", "months");

-- AddForeignKey: interest_config_rates -> interest_configs (cascade delete)
ALTER TABLE "interest_config_rates" ADD CONSTRAINT "interest_config_rates_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "interest_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
