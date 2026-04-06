-- Phase 5: Revenue & Operations
-- SalesCommission, CommissionRule, Contract.assignedToId, CallLog settlement fields

-- ============================================================
-- 1. New enums
-- ============================================================
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');
CREATE TYPE "CommissionRuleType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'TIERED');

-- ============================================================
-- 2. CommissionRule table
-- ============================================================
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rule_type" "CommissionRuleType" NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "fixed_amount" DECIMAL(12,2),
    "min_sale_amount" DECIMAL(12,2),
    "max_sale_amount" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 3. SalesCommission table
-- ============================================================
CREATE TABLE "sales_commissions" (
    "id" TEXT NOT NULL,
    "salesperson_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "sale_id" TEXT,
    "commission_rule_id" TEXT,
    "period" TEXT NOT NULL,
    "sale_amount" DECIMAL(12,2) NOT NULL,
    "commission_rate" DECIMAL(5,4) NOT NULL,
    "commission_amount" DECIMAL(12,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(12,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "sales_commissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_commissions_salesperson_id_idx" ON "sales_commissions"("salesperson_id");
CREATE INDEX "sales_commissions_contract_id_idx" ON "sales_commissions"("contract_id");
CREATE INDEX "sales_commissions_sale_id_idx" ON "sales_commissions"("sale_id");
CREATE INDEX "sales_commissions_period_idx" ON "sales_commissions"("period");
CREATE INDEX "sales_commissions_status_idx" ON "sales_commissions"("status");
CREATE INDEX "sales_commissions_deleted_at_idx" ON "sales_commissions"("deleted_at");

ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_salesperson_id_fkey"
FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_sale_id_fkey"
FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_commission_rule_id_fkey"
FOREIGN KEY ("commission_rule_id") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_approved_by_id_fkey"
FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 4. Contract.assignedToId (collections agent)
-- ============================================================
ALTER TABLE "contracts" ADD COLUMN "assigned_to_id" TEXT;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_assigned_to_id_fkey"
FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "contracts_assigned_to_id_idx" ON "contracts"("assigned_to_id");

-- ============================================================
-- 5. CallLog settlement fields
-- ============================================================
ALTER TABLE "call_logs" ADD COLUMN "settlement_date" TIMESTAMP(3);
ALTER TABLE "call_logs" ADD COLUMN "settlement_notes" TEXT;
