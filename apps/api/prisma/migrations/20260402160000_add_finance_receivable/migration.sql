-- CreateEnum
CREATE TYPE "FinanceReceivableStatus" AS ENUM ('PENDING', 'RECEIVED', 'PARTIALLY_RECEIVED', 'OVERDUE', 'DISPUTED');

-- CreateTable
CREATE TABLE "finance_receivables" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "finance_company" TEXT NOT NULL,
    "finance_ref_number" TEXT,
    "expected_amount" DECIMAL(12,2) NOT NULL,
    "commission_rate" DECIMAL(5,4),
    "commission_amount" DECIMAL(12,2),
    "net_expected_amount" DECIMAL(12,2) NOT NULL,
    "received_amount" DECIMAL(12,2),
    "received_date" TIMESTAMP(3),
    "bank_ref" TEXT,
    "expected_date" TIMESTAMP(3) NOT NULL,
    "status" "FinanceReceivableStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_receivables_sale_id_key" ON "finance_receivables"("sale_id");
CREATE INDEX "finance_receivables_status_idx" ON "finance_receivables"("status");
CREATE INDEX "finance_receivables_finance_company_idx" ON "finance_receivables"("finance_company");
CREATE INDEX "finance_receivables_branch_id_idx" ON "finance_receivables"("branch_id");
CREATE INDEX "finance_receivables_expected_date_idx" ON "finance_receivables"("expected_date");

-- AddForeignKey
ALTER TABLE "finance_receivables" ADD CONSTRAINT "finance_receivables_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_receivables" ADD CONSTRAINT "finance_receivables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_receivables" ADD CONSTRAINT "finance_receivables_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
