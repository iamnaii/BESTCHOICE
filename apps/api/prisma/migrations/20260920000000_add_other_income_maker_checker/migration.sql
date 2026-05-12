-- Add READY + APPROVED to OtherIncomeStatus enum
ALTER TYPE "OtherIncomeStatus" ADD VALUE 'READY';
ALTER TYPE "OtherIncomeStatus" ADD VALUE 'APPROVED';

-- Add approver/rejecter columns (all nullable — backward-compat)
ALTER TABLE "other_incomes"
  ADD COLUMN "approver_id"     TEXT,
  ADD COLUMN "approved_at"     TIMESTAMP(3),
  ADD COLUMN "approve_note"    TEXT,
  ADD COLUMN "rejected_by_id"  TEXT,
  ADD COLUMN "rejected_at"     TIMESTAMP(3),
  ADD COLUMN "reject_note"     TEXT;

-- FKs to User
ALTER TABLE "other_incomes"
  ADD CONSTRAINT "other_incomes_approver_id_fkey"
    FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "other_incomes_rejected_by_id_fkey"
    FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
