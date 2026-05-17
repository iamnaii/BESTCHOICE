-- Phase A.5 — Tax-disallowed expense flag for ภ.ง.ด.50/51 deduction filtering.
--
-- TFRS for NPAEs alignment: disallowed expenses are STILL booked normally
-- in the books (no special JE, no separate CoA routing). The flag only
-- affects the corporate income-tax filing (ภ.ง.ด.50/51) so the accountant
-- can deduct them from the deductible-expense total at year-end.
--
-- Typical disallowed examples (ม.65 ตรี ป.รัษฎากร):
--   - Personal expenses charged to the company
--   - Gifts / entertainment exceeding statutory cap (THB 2,000/event)
--   - Tax penalties + late-fees paid to the Revenue Department
--   - Donations beyond 2% / 10% caps
--
-- Two scopes:
--   - `expense_documents.tax_disallowed`: doc-level default for all lines.
--   - `expense_lines.tax_disallowed`: per-line override (rare; an EX doc
--     mixing deductible + non-deductible categories). When line-level is
--     true, the line is disallowed regardless of doc-level flag.
--
-- Both columns are NOT NULL with DEFAULT false → backwards compatible:
-- every existing row implicitly = "deductible" until the accountant flips it.

ALTER TABLE "expense_documents"
  ADD COLUMN "tax_disallowed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "expense_lines"
  ADD COLUMN "tax_disallowed" BOOLEAN NOT NULL DEFAULT false;

-- Partial-ish index: filters by (tax_disallowed, deletedAt). Used by the
-- ภ.ง.ด.50/51 summary endpoint to scan only flagged rows over a date range.
-- Composite covers both equality (tax_disallowed = true) and the soft-delete
-- guard in the same lookup.
CREATE INDEX "expense_documents_tax_disallowed_deleted_at_idx"
  ON "expense_documents" ("tax_disallowed", "deleted_at");
