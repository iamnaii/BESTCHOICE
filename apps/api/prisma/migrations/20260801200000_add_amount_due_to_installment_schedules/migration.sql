-- Add amountDue to InstallmentSchedule
-- Nullable so existing rows are unaffected without a backfill.
ALTER TABLE "installment_schedules" ADD COLUMN "amount_due" DECIMAL(12,2);
