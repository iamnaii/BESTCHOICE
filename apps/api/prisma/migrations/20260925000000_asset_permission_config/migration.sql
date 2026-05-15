-- PR 2a Task 6 (P7) — Permission metadata on FixedAsset (UI-only, no enforcement).
--
-- Array of { userId, canView, canEdit, canPost } persisted as JSONB. NOT NULL with
-- empty-array default so existing rows are valid without backfill. The legacy
-- `approver_id` column is retained — services may backfill into this array on
-- create/update when only the legacy field is supplied.

ALTER TABLE "fixed_assets"
  ADD COLUMN "permission_config" JSONB NOT NULL DEFAULT '[]';
