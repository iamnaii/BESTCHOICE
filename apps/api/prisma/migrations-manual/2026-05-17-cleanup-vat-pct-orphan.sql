-- D1.1.3.1 follow-up — soft-delete the legacy `vat_pct`/`vat_rate` rows
-- AFTER PR #940 (the backfill) has been verified.
--
-- Why this lives in a SEPARATE manual file from `2026-05-17-merge-vat-rate-keys.sql`:
--   - The backfill SQL deliberately leaves `vat_pct` in place so the operator
--     can verify `VAT_RATE` reflects the intended percentage before destroying
--     the source-of-truth.
--   - InterestConfigPage previously WROTE to `vat_pct` whenever OWNER saved
--     defaults — so even after the backfill + admin tab edit, the next time
--     OWNER opened InterestConfigPage and clicked "บันทึก" the orphan key
--     would regenerate. The frontend now writes to `VAT_RATE` (PR D1.1.3.1
--     follow-up, this branch). With both halves in place this cleanup is
--     idempotent and safe to re-run.
--
-- USAGE:
--   psql "$DATABASE_URL" -f apps/api/prisma/migrations-manual/2026-05-17-cleanup-vat-pct-orphan.sql
--
-- Operator will be prompted to type `YES_CLEANUP_VAT_PCT`. Anything else aborts.

\set ON_ERROR_STOP on

\echo '----------------------------------------------------------------------'
\echo 'D1.1.3.1 follow-up — about to soft-delete legacy vat_pct/vat_rate rows.'
\echo '----------------------------------------------------------------------'
\echo 'Current VAT-related SystemConfig rows:'

SELECT key, value, deleted_at IS NOT NULL AS soft_deleted
FROM system_config
WHERE key IN ('VAT_RATE', 'vat_pct', 'vat_rate')
ORDER BY key;

\echo ''
\echo 'Confirm VAT_RATE above matches the intended percentage (e.g. "7" = 7%).'
\echo 'After this script runs, vat_pct and vat_rate rows will be soft-deleted.'
\echo 'The frontend (InterestConfigPage) now writes to VAT_RATE so they will'
\echo 'not regenerate on next save.'
\echo ''

\prompt 'Type YES_CLEANUP_VAT_PCT to proceed (anything else aborts): ' CONFIRMATION

SELECT (:'CONFIRMATION' = 'YES_CLEANUP_VAT_PCT') AS proceed \gset

\if :proceed
  \echo 'Confirmed — soft-deleting legacy keys...'
\else
  \echo '!! ABORTED — confirmation string did not match YES_CLEANUP_VAT_PCT.'
  \echo '!! Nothing was written. Re-run to retry.'
  \q
\endif

BEGIN;

-- Soft-delete (so we can revert in emergencies). Idempotent — running twice
-- is a no-op because `deleted_at IS NULL` filters out already-deleted rows.
UPDATE system_config
SET deleted_at = NOW(),
    updated_at = NOW()
WHERE key IN ('vat_pct', 'vat_rate')
  AND deleted_at IS NULL;

COMMIT;

\echo 'Cleanup complete. Verify:'
\echo 'SELECT key, value, deleted_at FROM system_config WHERE key IN ('"'"'VAT_RATE'"'"', '"'"'vat_pct'"'"', '"'"'vat_rate'"'"');'
