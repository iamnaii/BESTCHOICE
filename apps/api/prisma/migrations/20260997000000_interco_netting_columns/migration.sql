-- Phase 2 device-swap workbook: หักกลบ 11-2107 ในรอบจ่าย INTER-CO (additive only)
DO $$ BEGIN
  CREATE TYPE "InterCoItemType" AS ENUM ('SETTLEMENT', 'RECALL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "inter_co_settlement_items"
  ADD COLUMN IF NOT EXISTS "item_type" "InterCoItemType" NOT NULL DEFAULT 'SETTLEMENT',
  ADD COLUMN IF NOT EXISTS "swap_credit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recall_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "inter_co_settlement_batches"
  ADD COLUMN IF NOT EXISTS "total_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "net_transfer_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "shop_net_amount" DECIMAL(12,2);
