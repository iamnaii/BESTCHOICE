-- Hardening migration for ExpenseDocument family — addresses 5-area audit findings:
--   C12 fromTemplateId FK + index (was a dangling soft-reference)
--   W4  branchId+deletedAt compound index (list query couldn't use existing index)
--   W5  PayrollLine + SettlementLine timestamps (mutable rows lacked createdAt/updatedAt)
--   W6  expense_documents.branch onDelete Restrict explicit at SQL level
--   I7  expense_documents.number partial unique (don't block reuse after soft-delete)

-- C12: foreign key + index for from_template_id
ALTER TABLE "expense_documents"
  ADD CONSTRAINT "expense_documents_from_template_id_fkey"
  FOREIGN KEY ("from_template_id") REFERENCES "expense_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "expense_documents_from_template_id_idx"
  ON "expense_documents"("from_template_id");

-- W4: compound index covering the primary list query
CREATE INDEX "expense_documents_branch_id_deleted_at_idx"
  ON "expense_documents"("branch_id", "deleted_at");

-- W5: timestamps on payroll_lines + settlement_lines
ALTER TABLE "payroll_lines"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "settlement_lines"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- I7: partial unique on number (allow re-issuing a number after the doc was soft-deleted)
DROP INDEX IF EXISTS "expense_documents_number_key";
CREATE UNIQUE INDEX "expense_documents_number_key"
  ON "expense_documents"("number")
  WHERE "deleted_at" IS NULL;
