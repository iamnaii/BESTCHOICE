-- P3-SP3: PEAK code mapping on ChartOfAccount
-- Adds nullable peak_code column + index for export reconciliation queries.
-- Owner fills via /settings#peak-mapping UI; export endpoint joins on this column.
-- Idempotent — safe to re-run.

ALTER TABLE "chart_of_accounts"
  ADD COLUMN IF NOT EXISTS "peak_code" VARCHAR(20);

CREATE INDEX IF NOT EXISTS "chart_of_accounts_peak_code_idx"
  ON "chart_of_accounts"("peak_code")
  WHERE "peak_code" IS NOT NULL;
