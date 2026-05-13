-- AlterTable
ALTER TABLE "accounting_periods"
  ADD COLUMN IF NOT EXISTS "reopen_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "tax_filed"     BOOLEAN;
