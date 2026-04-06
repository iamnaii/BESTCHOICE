-- Phase 2: Multi-Entity Foundation
-- Enhances CompanyInfo, adds Branch.companyId, creates JournalEntry/JournalLine,
-- adds company FKs to InterCompanyTransaction

-- ============================================================
-- 1. Enhance CompanyInfo with new fields
-- ============================================================
ALTER TABLE "company_info" ADD COLUMN "company_code" TEXT;
ALTER TABLE "company_info" ADD COLUMN "vat_registered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company_info" ADD COLUMN "vat_rate" DECIMAL(5,4);
ALTER TABLE "company_info" ADD COLUMN "bank_name" TEXT;
ALTER TABLE "company_info" ADD COLUMN "bank_account_name" TEXT;
ALTER TABLE "company_info" ADD COLUMN "bank_account_number" TEXT;
ALTER TABLE "company_info" ADD COLUMN "line_oa_id" TEXT;

-- Unique constraint on company_code
CREATE UNIQUE INDEX "company_info_company_code_key" ON "company_info"("company_code");

-- ============================================================
-- 2. Add companyId to Branch
-- ============================================================
ALTER TABLE "branches" ADD COLUMN "company_id" TEXT;
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company_info"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "branches_company_id_idx" ON "branches"("company_id");

-- ============================================================
-- 3. Create JournalEntry enum and tables
-- ============================================================
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "entry_number" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "reference_type" TEXT,
    "reference_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- Unique index on entry_number
CREATE UNIQUE INDEX "journal_entries_entry_number_key" ON "journal_entries"("entry_number");

-- JournalEntry indexes
CREATE INDEX "journal_entries_company_id_idx" ON "journal_entries"("company_id");
CREATE INDEX "journal_entries_entry_date_idx" ON "journal_entries"("entry_date");
CREATE INDEX "journal_entries_status_idx" ON "journal_entries"("status");
CREATE INDEX "journal_entries_reference_type_reference_id_idx" ON "journal_entries"("reference_type", "reference_id");
CREATE INDEX "journal_entries_deleted_at_idx" ON "journal_entries"("deleted_at");

-- JournalLine indexes
CREATE INDEX "journal_lines_journal_entry_id_idx" ON "journal_lines"("journal_entry_id");
CREATE INDEX "journal_lines_account_code_idx" ON "journal_lines"("account_code");

-- JournalEntry foreign keys
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company_info"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- JournalLine foreign key (cascade delete with parent entry)
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 4. Add company FKs to InterCompanyTransaction
-- ============================================================
ALTER TABLE "inter_company_transactions" ADD COLUMN "from_company_id" TEXT;
ALTER TABLE "inter_company_transactions" ADD COLUMN "to_company_id" TEXT;
ALTER TABLE "inter_company_transactions" ADD CONSTRAINT "inter_company_transactions_from_company_id_fkey" FOREIGN KEY ("from_company_id") REFERENCES "company_info"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inter_company_transactions" ADD CONSTRAINT "inter_company_transactions_to_company_id_fkey" FOREIGN KEY ("to_company_id") REFERENCES "company_info"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "inter_company_transactions_from_company_id_idx" ON "inter_company_transactions"("from_company_id");
CREATE INDEX "inter_company_transactions_to_company_id_idx" ON "inter_company_transactions"("to_company_id");
