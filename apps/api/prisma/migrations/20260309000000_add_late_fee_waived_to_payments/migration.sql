-- Add late_fee_waived column to payments table
ALTER TABLE "payments" ADD COLUMN "late_fee_waived" BOOLEAN NOT NULL DEFAULT false;
