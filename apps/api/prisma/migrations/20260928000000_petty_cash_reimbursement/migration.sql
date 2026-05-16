-- C1: PETTY_CASH_REIMBURSEMENT DocumentType + per-line supplier_name.
-- New doc type lifts the 1-doc-1-supplier rule for cash-float replenishment;
-- supplier_name moves from doc level (vendor_name) to per-line.

ALTER TYPE "DocumentType" ADD VALUE 'PETTY_CASH_REIMBURSEMENT';

ALTER TABLE "expense_lines" ADD COLUMN "supplier_name" TEXT;
