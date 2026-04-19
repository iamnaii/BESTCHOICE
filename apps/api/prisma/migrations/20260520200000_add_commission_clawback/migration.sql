-- T2-C6: Commission clawback on contract default
--
-- Adds two new enum values to CommissionStatus plus clawback tracking
-- columns on sales_commissions. The clawback schedule is:
--   - First-payment default (0-1 งวดจ่าย):  100%
--   - 2-3 งวดจ่าย:                           75%
--   - 4-6 งวดจ่าย:                           50%
--   - 7-12 งวดจ่าย:                          25%
--   - >12 งวดจ่าย:                             0%
-- The policy lives in code; these columns just record the result.

-- 1. Extend the enum
ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'CLAWED_BACK';
ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_CLAWED_BACK';

-- 2. Add clawback bookkeeping columns on the per-commission row
ALTER TABLE "sales_commissions"
  ADD COLUMN "clawback_amount"              DECIMAL(12, 2),
  ADD COLUMN "clawback_percent"             INT,
  ADD COLUMN "clawback_at"                  TIMESTAMP(3),
  ADD COLUMN "clawback_reason"              TEXT,
  ADD COLUMN "months_paid_before_default"   INT;
