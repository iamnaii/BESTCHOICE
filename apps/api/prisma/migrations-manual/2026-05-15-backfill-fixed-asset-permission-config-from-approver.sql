-- Manual one-shot backfill: legacy approverId → permissionConfig (PR #846 / P7 I2)
--
-- Context: PR #846 introduced FixedAsset.permission_config JSONB @default('[]')
-- to replace the legacy single approver_id column. The migration default ('[]')
-- leaves existing POSTED rows with a populated approver_id but an empty
-- permission_config — making the new Section 5 Permission UI render as empty
-- ("where did my approver go?").
--
-- This script backfills permission_config from approver_id for any row that
-- has a non-null approver_id and an empty permission_config. The legacy
-- approver_id is preserved (no destructive change). Default permission flags
-- mirror the UI defaults applied by AssetService.createDraft: canView+canPost
-- for the legacy approver, canEdit defaults to false.
--
-- Idempotent: re-running on already-backfilled rows is a no-op because the
-- WHERE clause checks for empty permission_config.
--
-- How to run:
--   psql $DATABASE_URL -f apps/api/prisma/migrations-manual/2026-05-15-backfill-fixed-asset-permission-config-from-approver.sql
--   -- or via Cloud SQL Auth Proxy / IAM-restricted access in prod
--
-- Verify post-run:
--   SELECT COUNT(*) FROM fixed_assets
--   WHERE approver_id IS NOT NULL
--     AND permission_config = '[]'::jsonb;
--   -- Expected: 0 rows (all approver_id rows backfilled)

BEGIN;

UPDATE fixed_assets
SET permission_config = jsonb_build_array(
  jsonb_build_object(
    'userId', approver_id,
    'canView', true,
    'canEdit', false,
    'canPost', true
  )
)
WHERE approver_id IS NOT NULL
  AND permission_config = '[]'::jsonb;

-- Sanity: log how many rows were affected (PostgreSQL psql will print "UPDATE N")

COMMIT;
