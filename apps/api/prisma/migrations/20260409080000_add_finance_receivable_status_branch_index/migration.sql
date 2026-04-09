-- Compound index to speed up the dashboard's "outstanding receivables by branch"
-- query, which always filters on (status, branchId). Single-column indexes on
-- status and branchId can't be combined as efficiently because PostgreSQL has
-- to AND bitmap scans, and status has only ~5 distinct values.
CREATE INDEX "finance_receivables_status_branch_id_idx" ON "finance_receivables"("status", "branch_id");
