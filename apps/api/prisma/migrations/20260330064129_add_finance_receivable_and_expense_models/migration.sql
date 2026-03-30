-- CreateEnum
CREATE TYPE "FinancePaymentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'FULLY_PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'UTILITIES', 'SALARY', 'COMMISSION', 'TRANSPORTATION', 'OFFICE_SUPPLIES', 'MARKETING', 'INSURANCE', 'MAINTENANCE', 'TAXES', 'INTERNET', 'PHONE_BILL', 'MISCELLANEOUS', 'OTHER');

-- CreateTable
CREATE TABLE "finance_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "credit_terms" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "finance_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_receivables" (
    "id" TEXT NOT NULL,
    "reference_number" TEXT NOT NULL,
    "finance_company_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "branch_id" TEXT NOT NULL,
    "expected_amount" DECIMAL(12,2) NOT NULL,
    "received_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "FinancePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "due_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "finance_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_receipts" (
    "id" TEXT NOT NULL,
    "receivable_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "payment_method" "PaymentMethod",
    "reference_number" TEXT,
    "evidence_url" TEXT,
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "expense_number" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "custom_category" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "expense_date" TIMESTAMP(3) NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "payment_method" "PaymentMethod",
    "reference_number" TEXT,
    "evidence_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_receivables_reference_number_key" ON "finance_receivables"("reference_number");

-- CreateIndex
CREATE INDEX "finance_receivables_finance_company_id_idx" ON "finance_receivables"("finance_company_id");

-- CreateIndex
CREATE INDEX "finance_receivables_contract_id_idx" ON "finance_receivables"("contract_id");

-- CreateIndex
CREATE INDEX "finance_receivables_branch_id_idx" ON "finance_receivables"("branch_id");

-- CreateIndex
CREATE INDEX "finance_receivables_status_idx" ON "finance_receivables"("status");

-- CreateIndex
CREATE INDEX "finance_receivables_due_date_idx" ON "finance_receivables"("due_date");

-- CreateIndex
CREATE INDEX "finance_receivables_deleted_at_idx" ON "finance_receivables"("deleted_at");

-- CreateIndex
CREATE INDEX "finance_receipts_receivable_id_idx" ON "finance_receipts"("receivable_id");

-- CreateIndex
CREATE INDEX "finance_receipts_payment_date_idx" ON "finance_receipts"("payment_date");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expense_number_key" ON "expenses"("expense_number");

-- CreateIndex
CREATE INDEX "expenses_branch_id_idx" ON "expenses"("branch_id");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expenses_month_year_idx" ON "expenses"("month", "year");

-- CreateIndex
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");

-- CreateIndex
CREATE INDEX "expenses_deleted_at_idx" ON "expenses"("deleted_at");

-- AddForeignKey
ALTER TABLE "finance_receivables" ADD CONSTRAINT "finance_receivables_finance_company_id_fkey" FOREIGN KEY ("finance_company_id") REFERENCES "finance_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivables" ADD CONSTRAINT "finance_receivables_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivables" ADD CONSTRAINT "finance_receivables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receivables" ADD CONSTRAINT "finance_receivables_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receipts" ADD CONSTRAINT "finance_receipts_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "finance_receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_receipts" ADD CONSTRAINT "finance_receipts_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
