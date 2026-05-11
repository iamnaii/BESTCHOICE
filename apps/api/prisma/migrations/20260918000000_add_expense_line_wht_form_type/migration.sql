-- Fix Report P2-4 — per-line WHT routing.
-- Adds optional whtFormType on ExpenseLine so a single doc can mix individual
-- (PND3 → 21-3102) and juristic (PND53 → 21-3103) vendors. When null, the JE
-- template falls back to the document-level whtFormType.

ALTER TABLE "expense_lines" ADD COLUMN "wht_form_type" TEXT;
