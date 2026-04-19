-- Per-branch daily reconciliation snapshot (T1-C4). Paired with a daily
-- cron that computes branch-level HP receivable balance vs aggregated
-- contract outstanding. 90-day retention via existing cron pattern.

CREATE TABLE "receivable_recon_logs" (
  "id"                   TEXT NOT NULL,
  "run_date"             DATE NOT NULL,
  "branch_id"            TEXT,
  "journal_balance"      DECIMAL(14,2) NOT NULL,
  "contract_outstanding" DECIMAL(14,2) NOT NULL,
  "gap"                  DECIMAL(14,2) NOT NULL,
  "threshold"            DECIMAL(14,2) NOT NULL,
  "breached"             BOOLEAN NOT NULL,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receivable_recon_logs_pkey" PRIMARY KEY ("id")
);

-- one row per branch per day (null branch = company-wide)
CREATE UNIQUE INDEX "receivable_recon_logs_run_date_branch_id_key"
  ON "receivable_recon_logs"("run_date", "branch_id");
CREATE INDEX "receivable_recon_logs_run_date_idx"
  ON "receivable_recon_logs"("run_date");
CREATE INDEX "receivable_recon_logs_branch_id_run_date_idx"
  ON "receivable_recon_logs"("branch_id", "run_date");
CREATE INDEX "receivable_recon_logs_breached_run_date_idx"
  ON "receivable_recon_logs"("breached", "run_date");

ALTER TABLE "receivable_recon_logs"
  ADD CONSTRAINT "receivable_recon_logs_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
