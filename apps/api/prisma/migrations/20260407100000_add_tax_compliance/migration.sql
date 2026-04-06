-- Phase 4: Tax & Compliance
-- TaxReport model, WhtIncomeType enum, DSARRequest.responseData

-- ============================================================
-- 1. New enums
-- ============================================================
CREATE TYPE "WhtIncomeType" AS ENUM ('SALARY_40_1', 'HIRE_40_2', 'ROYALTY_40_3', 'INTEREST_40_4A', 'DIVIDEND_40_4B', 'RENT_40_5', 'PROFESSION_40_6', 'CONTRACTOR_40_7', 'OTHER_40_8');
CREATE TYPE "TaxReportType" AS ENUM ('PP30', 'PND3', 'PND53');
CREATE TYPE "TaxReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'FILED');

-- ============================================================
-- 2. Migrate whtIncomeType from String to WhtIncomeType enum
-- ============================================================
-- Step 1: Rename old column
ALTER TABLE "expenses" RENAME COLUMN "wht_income_type" TO "wht_income_type_old";
-- Step 2: Add new enum column
ALTER TABLE "expenses" ADD COLUMN "wht_income_type" "WhtIncomeType";
-- Step 3: Migrate data (map common values)
UPDATE "expenses" SET "wht_income_type" = 'HIRE_40_2' WHERE "wht_income_type_old" = '40(2)';
UPDATE "expenses" SET "wht_income_type" = 'RENT_40_5' WHERE "wht_income_type_old" = '40(5)';
UPDATE "expenses" SET "wht_income_type" = 'OTHER_40_8' WHERE "wht_income_type_old" = '40(8)';
UPDATE "expenses" SET "wht_income_type" = 'CONTRACTOR_40_7' WHERE "wht_income_type_old" = '40(7)';
UPDATE "expenses" SET "wht_income_type" = 'SALARY_40_1' WHERE "wht_income_type_old" = '40(1)';
UPDATE "expenses" SET "wht_income_type" = 'PROFESSION_40_6' WHERE "wht_income_type_old" = '40(6)';
-- Step 4: Drop old column
ALTER TABLE "expenses" DROP COLUMN "wht_income_type_old";

-- ============================================================
-- 3. TaxReport table
-- ============================================================
CREATE TABLE "tax_reports" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "report_type" "TaxReportType" NOT NULL,
    "report_year" INTEGER NOT NULL,
    "report_month" INTEGER NOT NULL,
    "total_sales" DECIMAL(12,2),
    "total_vat_output" DECIMAL(12,2),
    "total_purchases" DECIMAL(12,2),
    "total_vat_input" DECIMAL(12,2),
    "net_vat" DECIMAL(12,2),
    "total_wht" DECIMAL(12,2),
    "transaction_count" INTEGER,
    "status" "TaxReportStatus" NOT NULL DEFAULT 'DRAFT',
    "generated_data" JSONB,
    "notes" TEXT,
    "filed_at" TIMESTAMP(3),
    "filed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tax_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tax_reports_company_id_report_type_report_year_report_month_key"
ON "tax_reports"("company_id", "report_type", "report_year", "report_month");
CREATE INDEX "tax_reports_company_id_idx" ON "tax_reports"("company_id");
CREATE INDEX "tax_reports_report_type_idx" ON "tax_reports"("report_type");
CREATE INDEX "tax_reports_report_year_report_month_idx" ON "tax_reports"("report_year", "report_month");
CREATE INDEX "tax_reports_status_idx" ON "tax_reports"("status");

ALTER TABLE "tax_reports" ADD CONSTRAINT "tax_reports_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "company_info"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_reports" ADD CONSTRAINT "tax_reports_filed_by_id_fkey"
FOREIGN KEY ("filed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 4. DSARRequest add responseData
-- ============================================================
ALTER TABLE "dsar_requests" ADD COLUMN "response_data" JSONB;
