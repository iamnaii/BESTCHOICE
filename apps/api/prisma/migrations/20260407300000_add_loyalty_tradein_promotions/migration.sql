-- Phase 6: Integrations & CX
-- Loyalty redemption, Trade-In, Promotions

-- ============================================================
-- 1. Customer loyalty balance
-- ============================================================
ALTER TABLE "customers" ADD COLUMN "loyalty_balance" INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 2. Loyalty Redemption
-- ============================================================
CREATE TABLE "loyalty_redemptions" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL,
    "contract_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "loyalty_redemptions_customer_id_idx" ON "loyalty_redemptions"("customer_id");
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 3. Trade-In
-- ============================================================
CREATE TYPE "TradeInStatus" AS ENUM ('PENDING_APPRAISAL', 'APPRAISED', 'ACCEPTED', 'REJECTED', 'COMPLETED');

CREATE TABLE "trade_ins" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "product_id" TEXT,
    "device_brand" TEXT NOT NULL,
    "device_model" TEXT NOT NULL,
    "device_storage" TEXT,
    "device_condition" TEXT,
    "imei" TEXT,
    "estimated_value" DECIMAL(12,2),
    "offered_price" DECIMAL(12,2),
    "agreed_price" DECIMAL(12,2),
    "status" "TradeInStatus" NOT NULL DEFAULT 'PENDING_APPRAISAL',
    "appraised_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "trade_ins_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trade_ins_customer_id_idx" ON "trade_ins"("customer_id");
CREATE INDEX "trade_ins_status_idx" ON "trade_ins"("status");
CREATE INDEX "trade_ins_created_at_idx" ON "trade_ins"("created_at");
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_appraised_by_id_fkey"
FOREIGN KEY ("appraised_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 4. Promotions
-- ============================================================
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT', 'FREE_ACCESSORY', 'SPECIAL_RATE');

CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "discount_value" DECIMAL(12,2),
    "special_interest_rate" DECIMAL(5,4),
    "conditions" JSONB,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "max_usage_count" INTEGER,
    "current_usage_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "promotions_start_date_end_date_idx" ON "promotions"("start_date", "end_date");
CREATE INDEX "promotions_is_active_idx" ON "promotions"("is_active");

CREATE TABLE "promotion_usages" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "sale_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "discount_applied" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promotion_usages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "promotion_usages_promotion_id_idx" ON "promotion_usages"("promotion_id");
CREATE INDEX "promotion_usages_sale_id_idx" ON "promotion_usages"("sale_id");
CREATE INDEX "promotion_usages_customer_id_idx" ON "promotion_usages"("customer_id");
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_promotion_id_fkey"
FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_sale_id_fkey"
FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
