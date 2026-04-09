-- FK indexes that the audit found missing. Each index speeds up a
-- specific dashboard or report query that currently does a full-table
-- scan when filtering by the indexed column.
--
-- All CREATE INDEX statements are non-blocking on PostgreSQL with
-- CONCURRENTLY — but Prisma's `migrate deploy` runs each statement
-- in its own implicit transaction, and CREATE INDEX CONCURRENTLY
-- can't run inside a transaction. So we use plain CREATE INDEX, which
-- briefly locks the table for writes. Tables affected are
-- low-traffic enough (bad_debt_provisions, trade_ins, expenses)
-- that the lock is acceptable during deploy.

-- bad_debt_provisions: "writeoffs by approver" + "pending approvals"
CREATE INDEX "bad_debt_provisions_written_off_by_id_idx" ON "bad_debt_provisions"("written_off_by_id");
CREATE INDEX "bad_debt_provisions_approved_by_id_idx" ON "bad_debt_provisions"("approved_by_id");

-- trade_ins: "appraisal queue by staff"
CREATE INDEX "trade_ins_appraised_by_id_idx" ON "trade_ins"("appraised_by_id");
CREATE INDEX "trade_ins_id_card_verified_by_id_idx" ON "trade_ins"("id_card_verified_by_id");

-- expenses: "expenses by branch in date range" dashboard query
CREATE INDEX "expenses_branch_id_expense_date_idx" ON "expenses"("branch_id", "expense_date");
-- expenses: approver dropdown filter
CREATE INDEX "expenses_approved_by_id_idx" ON "expenses"("approved_by_id");
