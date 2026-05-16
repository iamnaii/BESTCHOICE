-- D1.1.3.1 — VAT_RATE/vat_pct orphan-key fix
--
-- Manual (NOT auto-applied) migration. Run via psql AFTER verifying that
-- the legacy `vat_pct` / `vat_rate` rows agree with the operator's intent.
--
-- Background:
--   - Code path 1 (legacy): `purchase-orders.service.ts`, `config.util.ts`,
--     `InterestConfigPage.tsx` read SystemConfig key `vat_pct` expecting the
--     DECIMAL form ("0.07" = 7%).
--   - Code path 2 (newer admin UI): `SettingsPage > VAT` tab (VatTab.tsx)
--     writes SystemConfig key `VAT_RATE` in the PERCENTAGE form ("7" = 7%).
--
-- After PR D1.1.3.1 all readers use the canonical-key-first helper
-- `loadVatRateDecimal()` which:
--   1. Reads VAT_RATE   (percentage)
--   2. Falls back to vat_pct (decimal-or-percent — parser handles both)
--   3. Falls back to vat_rate (decimal)
--   4. Defaults to 0.07 (7%)
--
-- This SQL is a SAFETY NET — it ensures `VAT_RATE` is populated even if the
-- operator never touched the new admin tab.
--
-- USAGE (single transaction so the file can be re-run safely):
--   psql $DATABASE_URL -f apps/api/prisma/migrations-manual/2026-05-17-merge-vat-rate-keys.sql
--
-- After running:
--   1. Verify `SELECT key, value FROM system_config WHERE key IN ('VAT_RATE', 'vat_pct', 'vat_rate');`
--   2. Confirm with the OWNER that `VAT_RATE` reflects the intended percent.
--   3. Once verified, OPTIONALLY delete the legacy keys:
--        UPDATE system_config SET deleted_at = NOW()
--        WHERE key IN ('vat_pct', 'vat_rate') AND deleted_at IS NULL;
--      (We soft-delete so an emergency revert can restore them.)

BEGIN;

-- Step 1: backfill VAT_RATE from legacy `vat_pct` if VAT_RATE is missing.
-- Stored as a percentage (multiply decimal by 100) — matches the form that
-- the new admin UI saves and that downstream code's parser expects.
INSERT INTO system_config (id, key, value, created_at, updated_at)
SELECT
    gen_random_uuid(),
    'VAT_RATE',
    CASE
        WHEN (vp.value)::numeric >= 1 THEN vp.value        -- already percent-shaped
        ELSE ((vp.value)::numeric * 100)::text             -- decimal → percent
    END,
    NOW(),
    NOW()
FROM system_config vp
WHERE vp.key = 'vat_pct'
  AND vp.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM system_config
      WHERE key = 'VAT_RATE' AND deleted_at IS NULL
  );

-- Step 2: same backfill from `vat_rate` (decimal form) if neither VAT_RATE
-- nor vat_pct was present.
INSERT INTO system_config (id, key, value, created_at, updated_at)
SELECT
    gen_random_uuid(),
    'VAT_RATE',
    CASE
        WHEN (vr.value)::numeric >= 1 THEN vr.value
        ELSE ((vr.value)::numeric * 100)::text
    END,
    NOW(),
    NOW()
FROM system_config vr
WHERE vr.key = 'vat_rate'
  AND vr.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM system_config
      WHERE key = 'VAT_RATE' AND deleted_at IS NULL
  );

-- NOTE: legacy keys (`vat_pct`, `vat_rate`) are intentionally LEFT IN PLACE.
-- Deleting them in the same transaction risks data loss if the SQL is run
-- against a DB where `VAT_RATE` already exists with a stale value. Operator
-- should verify VAT_RATE matches the intended percent, then run the
-- soft-delete UPDATE in the header comment.

COMMIT;

-- Verification query (run separately):
-- SELECT key, value, created_at, updated_at FROM system_config
-- WHERE key IN ('VAT_RATE', 'vat_pct', 'vat_rate')
-- ORDER BY key;
