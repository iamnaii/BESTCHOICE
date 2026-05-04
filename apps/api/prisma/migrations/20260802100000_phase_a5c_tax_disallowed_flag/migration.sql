-- Phase A.5c: Add taxDisallowed flag and disallowedReason to Expense
-- Migration: phase_a5c_tax_disallowed_flag

ALTER TABLE "expenses" ADD COLUMN "tax_disallowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN "disallowed_reason" TEXT;
