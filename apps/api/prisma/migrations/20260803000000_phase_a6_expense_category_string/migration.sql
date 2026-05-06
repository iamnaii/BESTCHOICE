-- Phase A.6: Expense.category enum → String
-- Allows the column to store either legacy ExpenseCategory enum values
-- (e.g. ADMIN_SALARY) OR CoA codes (e.g. 53-1101) sent by the updated UI.
--
-- PostgreSQL cannot alter an enum-backed column to TEXT directly.
-- The USING clause casts the existing enum values to text preserving all data.

ALTER TABLE "expenses"
  ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;
