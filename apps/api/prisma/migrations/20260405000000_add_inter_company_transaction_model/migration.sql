-- CreateEnum
CREATE TYPE "InterCompanyTransactionType" AS ENUM ('FINANCE_PURCHASE', 'COMMISSION_PAYMENT', 'LATE_FEE_SHARE');

-- CreateEnum
CREATE TYPE "InterCompanyTransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RECONCILED', 'CANCELLED');

-- AlterTable: add storeCommission to contracts
ALTER TABLE "contracts" ADD COLUMN "store_commission" DECIMAL(12,2);

-- AlterTable: add deletedAt/updatedAt to related tables (pre-existing schema drift fix)
ALTER TABLE "branch_receiving_items" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
-- Backfill updated_at for existing rows
UPDATE "branch_receiving_items" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "branch_receiving_items" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "branch_receiving_items" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "e_documents" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "goods_receiving_items" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

ALTER TABLE "stock_count_items" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "stock_count_items" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "stock_count_items" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "stock_count_items" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "supplier_payment_methods" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "inter_company_transactions" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "branch_id" TEXT NOT NULL,
    "type" "InterCompanyTransactionType" NOT NULL,
    "status" "InterCompanyTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "from_entity" TEXT NOT NULL,
    "to_entity" TEXT NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL,
    "commission_pct" DECIMAL(5,4) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "vat_pct" DECIMAL(5,4) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "interest_total" DECIMAL(12,2) NOT NULL,
    "cost_price" DECIMAL(12,2) NOT NULL,
    "down_payment" DECIMAL(12,2) NOT NULL,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "shop_profit" DECIMAL(12,2) NOT NULL,
    "finance_profit" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inter_company_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inter_company_transactions_sale_id_idx" ON "inter_company_transactions"("sale_id");
CREATE INDEX "inter_company_transactions_contract_id_idx" ON "inter_company_transactions"("contract_id");
CREATE INDEX "inter_company_transactions_branch_id_idx" ON "inter_company_transactions"("branch_id");
CREATE INDEX "inter_company_transactions_type_idx" ON "inter_company_transactions"("type");
CREATE INDEX "inter_company_transactions_status_idx" ON "inter_company_transactions"("status");
CREATE INDEX "inter_company_transactions_from_entity_idx" ON "inter_company_transactions"("from_entity");
CREATE INDEX "inter_company_transactions_to_entity_idx" ON "inter_company_transactions"("to_entity");
CREATE INDEX "inter_company_transactions_created_at_idx" ON "inter_company_transactions"("created_at");
CREATE INDEX "inter_company_transactions_deleted_at_idx" ON "inter_company_transactions"("deleted_at");

-- AddForeignKey
ALTER TABLE "inter_company_transactions" ADD CONSTRAINT "inter_company_transactions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inter_company_transactions" ADD CONSTRAINT "inter_company_transactions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inter_company_transactions" ADD CONSTRAINT "inter_company_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
