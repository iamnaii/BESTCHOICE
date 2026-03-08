-- AlterTable
ALTER TABLE "interest_configs" ADD COLUMN "store_commission_pct" DECIMAL(5,4) NOT NULL DEFAULT 0.10;
ALTER TABLE "interest_configs" ADD COLUMN "vat_pct" DECIMAL(5,4) NOT NULL DEFAULT 0.07;
