-- D1.1.3.1 — VAT_RATE/vat_pct orphan-key fix
--
-- Manual (NOT auto-applied) migration. Run via psql AFTER verifying that
-- the legacy `vat_pct` / `vat_rate` rows agree with the operator's intent.
--
-- ============================================================================
-- !! OPERATOR CONFIRMATION REQUIRED !!
-- ============================================================================
-- This file MUST be executed with `psql` so the `\prompt` directive runs.
-- Running it with anything else (DBeaver "execute file", pgAdmin, copy-paste
-- into a generic SQL client) will likely SKIP the confirmation gate and
-- silently execute the backfill — which is exactly what the gate prevents.
--
-- Correct invocation:
--   psql "$DATABASE_URL" -f apps/api/prisma/migrations-manual/2026-05-17-merge-vat-rate-keys.sql
--
-- Operator will be prompted to type `YES_BACKFILL_VAT`. Anything else aborts.
-- ============================================================================
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
-- ---------------------------------------------------------------------------
-- AMBIGUOUS-VALUE EDGE CASE (the reason the gate is mandatory)
-- ---------------------------------------------------------------------------
-- The shape detector `(vp.value)::numeric >= 1 THEN value ELSE value * 100`
-- is a heuristic. It works perfectly for the canonical Thai VAT values:
--     '0.07'  → '7'    (correct: 7% decimal → 7% percent)
--     '7'     → '7'    (correct: already percent)
--     '0.10'  → '10'   (correct, used during temporary 10% VAT period)
--
-- It FAILS SILENTLY for unusual stored values:
--     '0.7'   → '70'   (treats 0.7 as a decimal fraction = 70% VAT;
--                       likely the operator meant 0.7% — but this script
--                       cannot tell the two intents apart from the value alone)
--     '1.0'   → '1'    (interpreted as 1% — likely wrong if intent was 100%)
--
-- The operator MUST inspect current row values using the verification query
-- at the bottom of this file BEFORE typing the confirmation token. If any
-- value smells wrong (especially 0.7 / 1.0 / values that look like decimal
-- fractions but are >= 0.1), fix it BY HAND first and re-run.
--
-- After this file runs you also need to soft-delete the legacy keys (see
-- the soft-delete UPDATE in the verification section) so future writers
-- don't reintroduce the ambiguity.
--
-- USAGE (single transaction so the file can be re-run safely):
--   psql "$DATABASE_URL" -f apps/api/prisma/migrations-manual/2026-05-17-merge-vat-rate-keys.sql
--
-- After running:
--   1. Verify `SELECT key, value FROM system_config WHERE key IN ('VAT_RATE', 'vat_pct', 'vat_rate');`
--   2. Confirm with the OWNER that `VAT_RATE` reflects the intended percent.
--   3. Once verified, OPTIONALLY delete the legacy keys:
--        UPDATE system_config SET deleted_at = NOW()
--        WHERE key IN ('vat_pct', 'vat_rate') AND deleted_at IS NULL;
--      (We soft-delete so an emergency revert can restore them.)

\set ON_ERROR_STOP on

\echo '----------------------------------------------------------------------'
\echo 'D1.1.3.1 VAT_RATE backfill — about to inspect current state.'
\echo '----------------------------------------------------------------------'
\echo 'Current VAT-related SystemConfig rows:'

SELECT key, value, deleted_at IS NOT NULL AS soft_deleted
FROM system_config
WHERE key IN ('VAT_RATE', 'vat_pct', 'vat_rate')
ORDER BY key;

\echo ''
\echo 'Review the values above. If any value looks ambiguous (e.g. 0.7 / 1.0),'
\echo 'abort here and fix it by hand first.'
\echo ''

-- Operator confirmation prompt. Skips the backfill unless the operator
-- types `YES_BACKFILL_VAT` exactly (case-sensitive). Any other string,
-- empty input, or running via a client that ignores \prompt → abort.
\prompt 'Type YES_BACKFILL_VAT to proceed (anything else aborts): ' CONFIRMATION

-- Materialize the comparison into a psql boolean variable via \gset.
-- We can't use raw "\if :'CONFIRMATION' = 'YES_BACKFILL_VAT'" because
-- psql's \if does NOT evaluate SQL-like comparison expressions.
SELECT (:'CONFIRMATION' = 'YES_BACKFILL_VAT') AS proceed \gset

\if :proceed
  \echo 'Confirmed — running backfill...'
\else
  \echo '!! ABORTED — confirmation string did not match YES_BACKFILL_VAT.'
  \echo '!! Nothing was written. Re-run to retry.'
  \q
\endif

-- ============================================================================
-- Confirmed — backfill below
-- ============================================================================

-- Ensure gen_random_uuid() is available. pgcrypto is enabled on GCP Cloud SQL
-- by default; this CREATE is idempotent and protects fresh local databases.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

\echo 'Backfill complete. Run the verification query below to confirm the result.'

-- Verification query (run separately):
-- SELECT key, value, created_at, updated_at FROM system_config
-- WHERE key IN ('VAT_RATE', 'vat_pct', 'vat_rate')
-- ORDER BY key;
