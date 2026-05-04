-- Phase A.4: CPA Chart Adoption
-- Removes multi-entity companyId scoping from ChartOfAccount,
-- drops A.2 deferred-income fields from Contract,
-- adds cash-account dimension to Payment + User,
-- adds metadata to JournalEntry,
-- creates InstallmentSchedule model.
--
-- DEPLOYMENT ORDER WARNING:
-- This migration adds NOT NULL columns (name, normalBalance, type) on chart_of_accounts
-- and drops columns on contracts. Both tables must be empty or the NOT NULL additions will fail.
-- Accounting has NOT gone live in production — chart_of_accounts will be wiped and reseeded.
-- Required deploy sequence:
--   1. Run wipe CLI: CONFIRM_WIPE=... EXPECTED_DB_NAME=... npm --prefix apps/api run wipe:accounting
--   2. Then run:    npx prisma migrate deploy
-- For fresh dev environments: prisma migrate reset auto-orders correctly (no manual wipe needed).

-- DropForeignKey
ALTER TABLE "chart_of_accounts" DROP CONSTRAINT "chart_of_accounts_company_id_fkey";

-- DropIndex
DROP INDEX "chart_of_accounts_account_group_idx";

-- DropIndex
DROP INDEX "chart_of_accounts_code_idx";

-- DropIndex
DROP INDEX "chart_of_accounts_company_id_idx";

-- DropIndex
DROP INDEX "chart_of_accounts_company_id_code_key";

-- AlterTable (users)
ALTER TABLE "users" ADD COLUMN     "default_cash_account_code" TEXT;

-- AlterTable (contracts) — remove A.2 deferred-income fields
ALTER TABLE "contracts" DROP COLUMN "unearned_commission",
DROP COLUMN "unearned_interest";

-- AlterTable (payments) — add cash account dimension + tolerance JE link
ALTER TABLE "payments" ADD COLUMN     "deposit_account_code" TEXT,
ADD COLUMN     "tolerance_journal_line_id" TEXT;

-- AlterTable (chart_of_accounts) — replace old schema with CPA schema
ALTER TABLE "chart_of_accounts" DROP COLUMN "account_group",
DROP COLUMN "company_id",
DROP COLUMN "created_at",
DROP COLUMN "deleted_at",
DROP COLUMN "is_active",
DROP COLUMN "level",
DROP COLUMN "name_en",
DROP COLUMN "name_th",
DROP COLUMN "parent_code",
DROP COLUMN "peak_account_code",
DROP COLUMN "peak_account_id",
DROP COLUMN "updated_at",
ADD COLUMN     "category" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "normalBalance" TEXT NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ใช้งาน',
ADD COLUMN     "type" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "vatApplicable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable (journal_entries) — add metadata for T6+ template tags
ALTER TABLE "journal_entries" ADD COLUMN     "metadata" JSONB;

-- CreateTable
CREATE TABLE "installment_schedules" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "installment_no" INTEGER NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    "interest" DECIMAL(12,2) NOT NULL,
    "rescheduled_from_date" TIMESTAMP(3),
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "accrual_journal_entry_id" TEXT,
    "vat_60day_journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "installment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "installment_schedules_contract_id_idx" ON "installment_schedules"("contract_id");

-- CreateIndex
CREATE INDEX "installment_schedules_due_date_idx" ON "installment_schedules"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "installment_schedules_contract_id_installment_no_key" ON "installment_schedules"("contract_id", "installment_no");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_code_key" ON "chart_of_accounts"("code");

-- AddForeignKey
ALTER TABLE "installment_schedules" ADD CONSTRAINT "installment_schedules_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
