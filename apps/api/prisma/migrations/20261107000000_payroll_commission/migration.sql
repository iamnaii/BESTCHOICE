-- Payroll D4 part 2 — approved commissions pulled into SHOP payroll; clawbacks deducted.

-- ADD VALUE is not used by any later statement in this migration, so it is safe inside the tx.
ALTER TYPE "PayrollIncomeSource" ADD VALUE 'COMMISSION';

CREATE TYPE "PayrollDeductionSource" AS ENUM ('MANUAL', 'COMMISSION_CLAWBACK');
CREATE TYPE "PayrollCommissionItemKind" AS ENUM ('PAY', 'CLAWBACK');

ALTER TABLE "payroll_custom_deduction"
  ADD COLUMN "source" "PayrollDeductionSource" NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "payroll_commission_items" (
  "id" TEXT NOT NULL,
  "payroll_line_id" TEXT NOT NULL,
  "sales_commission_id" TEXT NOT NULL,
  "kind" "PayrollCommissionItemKind" NOT NULL,
  "account_code" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_commission_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payroll_commission_items"
  ADD CONSTRAINT "payroll_commission_items_payroll_line_id_fkey"
    FOREIGN KEY ("payroll_line_id") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_commission_items_sales_commission_id_fkey"
    FOREIGN KEY ("sales_commission_id") REFERENCES "sales_commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "payroll_commission_items_sales_commission_id_idx" ON "payroll_commission_items"("sales_commission_id");
CREATE INDEX "payroll_commission_items_payroll_line_id_idx" ON "payroll_commission_items"("payroll_line_id");

-- SQL-only (Prisma cannot express a partial index): one live PAY item per commission.
-- `prisma migrate diff` will want to drop this — never accept that.
CREATE UNIQUE INDEX "payroll_commission_items_one_active_pay"
  ON "payroll_commission_items" ("sales_commission_id")
  WHERE "kind" = 'PAY' AND "released_at" IS NULL;

-- S51-1101 exists only via seed-coa-shop on dev/prod; migrations-only DBs (CI) need it
-- for AccountRoleService.assertCodesExistInCoa. Values per shop-coa.csv. No-op where present.
INSERT INTO "chart_of_accounts"
  ("id", "code", "name", "type", "normalBalance", "category", "vatApplicable", "notes", "status", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'S51-1101', 'ค่าคอมพนักงานขายสาขา', 'ค่าใช้จ่าย', 'Dr', 'ค่าใช้จ่ายขาย', FALSE,
   'ค่าคอมพนักงานขายสาขา (per-piece หรือ %)', 'ใช้งาน', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- SHOP only: FINANCE payroll never pulls commissions, so there is no non-shop role.
INSERT INTO "account_role_map" ("id", "role", "account_code", "priority", "is_active", "note", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'shop_payroll_commission', 'S51-1101', 1, TRUE, 'ค่าคอมมิชชันพนักงานขาย - เงินเดือนสาขา (SHOP)', NOW(), NOW())
ON CONFLICT ("role", "account_code") DO NOTHING;
