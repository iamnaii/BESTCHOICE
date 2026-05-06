-- Other Income module: 4 tables + 3 enums for 42-XXXX account entries

-- CreateEnum
CREATE TYPE "OtherIncomeStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "OtherIncomePriceType" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- CreateEnum
CREATE TYPE "OtherIncomeReverseReason" AS ENUM ('INPUT_ERROR', 'CUSTOMER_REQUEST', 'DUPLICATE', 'WRONG_ACCOUNT', 'WRONG_AMOUNT', 'OTHER');

-- CreateTable
CREATE TABLE "other_incomes" (
    "id" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "status" "OtherIncomeStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "payment_date" TIMESTAMP(3),
    "price_type" "OtherIncomePriceType" NOT NULL DEFAULT 'EXCLUSIVE',
    "customer_id" TEXT,
    "counterparty_name" TEXT,
    "counterparty_tax_id" TEXT,
    "counterparty_address" TEXT,
    "counterparty_phone" TEXT,
    "payment_account_code" TEXT NOT NULL,
    "amount_received" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "income_gross" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "net_received" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "receipt_no" TEXT,
    "journal_entry_id" TEXT,
    "is_overridden" BOOLEAN NOT NULL DEFAULT false,
    "customer_note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3),
    "reverses_id" TEXT,
    "reverse_reason" "OtherIncomeReverseReason",
    "reverse_note" TEXT,
    "copied_from_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "other_incomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_income_items" (
    "id" TEXT NOT NULL,
    "other_income_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(15,2) NOT NULL DEFAULT 1,
    "unit_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "vat_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "wht_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount_before_vat" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "other_income_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_income_adjustments" (
    "id" TEXT NOT NULL,
    "other_income_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_code" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "other_income_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_income_attachments" (
    "id" TEXT NOT NULL,
    "other_income_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "other_income_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "other_incomes_doc_number_key" ON "other_incomes"("doc_number");

-- CreateIndex
CREATE UNIQUE INDEX "other_incomes_receipt_no_key" ON "other_incomes"("receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "other_incomes_journal_entry_id_key" ON "other_incomes"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "other_incomes_reverses_id_key" ON "other_incomes"("reverses_id");

-- CreateIndex
CREATE INDEX "other_incomes_company_id_idx" ON "other_incomes"("company_id");

-- CreateIndex
CREATE INDEX "other_incomes_status_issue_date_idx" ON "other_incomes"("status", "issue_date");

-- CreateIndex
CREATE INDEX "other_incomes_customer_id_idx" ON "other_incomes"("customer_id");

-- CreateIndex
CREATE INDEX "other_incomes_deleted_at_idx" ON "other_incomes"("deleted_at");

-- CreateIndex
CREATE INDEX "other_incomes_issue_date_idx" ON "other_incomes"("issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "other_income_items_other_income_id_line_no_key" ON "other_income_items"("other_income_id", "line_no");

-- CreateIndex
CREATE INDEX "other_income_items_account_code_idx" ON "other_income_items"("account_code");

-- CreateIndex
CREATE UNIQUE INDEX "other_income_adjustments_other_income_id_line_no_key" ON "other_income_adjustments"("other_income_id", "line_no");

-- AddForeignKey
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company_info"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "other_incomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_copied_from_id_fkey" FOREIGN KEY ("copied_from_id") REFERENCES "other_incomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_income_items" ADD CONSTRAINT "other_income_items_other_income_id_fkey" FOREIGN KEY ("other_income_id") REFERENCES "other_incomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_income_adjustments" ADD CONSTRAINT "other_income_adjustments_other_income_id_fkey" FOREIGN KEY ("other_income_id") REFERENCES "other_incomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_income_attachments" ADD CONSTRAINT "other_income_attachments_other_income_id_fkey" FOREIGN KEY ("other_income_id") REFERENCES "other_incomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_income_attachments" ADD CONSTRAINT "other_income_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "other_income_attachments_other_income_id_idx" ON "other_income_attachments"("other_income_id");

-- Enforce adjustment amount > 0 (V14 at DB level)
ALTER TABLE "other_income_adjustments"
  ADD CONSTRAINT "other_income_adjustments_amount_positive" CHECK ("amount" > 0);
