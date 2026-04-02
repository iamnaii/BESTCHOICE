-- CreateEnum
CREATE TYPE "ExpenseAccountType" AS ENUM ('COST_OF_SALES', 'SELLING_EXPENSE', 'ADMINISTRATIVE_EXPENSE', 'OTHER_EXPENSE');

CREATE TYPE "ExpenseCategory" AS ENUM (
  'COGS_PRODUCT', 'COGS_REPAIR_PARTS',
  'SELL_COMMISSION', 'SELL_ADVERTISING', 'SELL_TRANSPORT', 'SELL_PACKAGING',
  'ADMIN_SALARY', 'ADMIN_SOCIAL_SECURITY', 'ADMIN_RENT', 'ADMIN_UTILITIES',
  'ADMIN_OFFICE_SUPPLIES', 'ADMIN_DEPRECIATION', 'ADMIN_INSURANCE', 'ADMIN_TAX_FEE',
  'ADMIN_MAINTENANCE', 'ADMIN_TRAVEL', 'ADMIN_TELEPHONE',
  'OTHER_INTEREST', 'OTHER_LOSS', 'OTHER_FINE', 'OTHER_MISC'
);

CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'VOIDED');

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "expense_number" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "account_type" "ExpenseAccountType" NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "account_code" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "withholding_tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expense_date" TIMESTAMP(3) NOT NULL,
    "payment_method" "PaymentMethod",
    "payment_date" TIMESTAMP(3),
    "reference" TEXT,
    "vendor_name" TEXT,
    "vendor_tax_id" TEXT,
    "receipt_image_url" TEXT,
    "tax_invoice_no" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurring_day" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expense_number_key" ON "expenses"("expense_number");
CREATE INDEX "expenses_branch_id_idx" ON "expenses"("branch_id");
CREATE INDEX "expenses_account_type_idx" ON "expenses"("account_type");
CREATE INDEX "expenses_category_idx" ON "expenses"("category");
CREATE INDEX "expenses_status_idx" ON "expenses"("status");
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");
CREATE INDEX "expenses_created_by_id_idx" ON "expenses"("created_by_id");
CREATE INDEX "expenses_deleted_at_idx" ON "expenses"("deleted_at");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
