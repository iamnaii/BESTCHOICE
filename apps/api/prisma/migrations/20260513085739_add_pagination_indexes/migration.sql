-- AddIndex: (status, created_at DESC) on other_incomes for pagination ORDER BY
-- Supports: WHERE status=? ORDER BY created_at DESC LIMIT N queries in OtherIncome list page
CREATE INDEX IF NOT EXISTS "other_incomes_status_created_at_idx"
  ON "other_incomes"("status", "created_at" DESC);

-- AddIndex: (status, created_at DESC) on expense_documents for pagination ORDER BY
-- Supports: WHERE status=? ORDER BY created_at DESC LIMIT N queries in Expense list page
CREATE INDEX IF NOT EXISTS "expense_documents_status_created_at_idx"
  ON "expense_documents"("status", "created_at" DESC);

-- Note: audit_logs already has @@index([createdAt]) — no additional index needed.
