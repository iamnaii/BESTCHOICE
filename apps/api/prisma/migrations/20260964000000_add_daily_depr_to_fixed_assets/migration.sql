-- Daily straight-line depreciation: store the 4-dp daily rate alongside the
-- nominal monthly figure. Additive + safe (default 0, then backfilled).
-- dailyDepr = (cost − salvage) ÷ (usefulLifeMonths ÷ 12 × 365)

ALTER TABLE "fixed_assets"
  ADD COLUMN IF NOT EXISTS "daily_depr" DECIMAL(12, 4) NOT NULL DEFAULT 0;

-- Backfill existing rows from the same formula the service uses.
UPDATE "fixed_assets"
SET "daily_depr" = ROUND(
  ("purchase_cost" - "residual_value")
    / (("useful_life_months"::numeric * 365) / 12),
  4
)
WHERE "useful_life_months" > 0
  AND ("purchase_cost" - "residual_value") > 0;
