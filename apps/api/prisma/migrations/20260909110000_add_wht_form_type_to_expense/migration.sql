-- Phase A.5b legal-compliance: explicit WHT form type on Expense.
-- Replaces the heuristic vendorTaxId-startsWith-'0' routing in expense.template.ts.
-- Nullable + additive — safe to apply to populated tables.
ALTER TABLE "expenses"
  ADD COLUMN "wht_form_type" TEXT;
