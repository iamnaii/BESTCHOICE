-- Manual operation only; not part of prisma migrate deploy.
-- See docs/runbooks/2026-10-04-credit-precheck-config-cleanup.md.
\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif
\if :{?snapshot_file}
\else
  \echo 'Missing snapshot_file; no changes made.'
  DO $$ BEGIN RAISE EXCEPTION 'Precondition failed; no changes made.'; END $$;
\endif

BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT id FROM public.system_config
WHERE key = 'credit_precheck_ai_enabled' FOR UPDATE;

SELECT count(*) = 1 AND coalesce(bool_and(
  value = 'false' AND deleted_at IS NULL
  AND updated_at = timestamp '2026-08-29 04:09:21.429'
), false) AS matches_snapshot
FROM public.system_config WHERE key = 'credit_precheck_ai_enabled'
\gset
\if :matches_snapshot
\else
  ROLLBACK;
  \echo 'STOP: missing, already deleted, or changed since audited snapshot.'
  DO $$ BEGIN RAISE EXCEPTION 'Precondition failed; no changes made.'; END $$;
\endif

-- Snapshot the locked row before changing it. A failed output write stops psql
-- and disconnect rolls the transaction back. Use a new private file per run.
SELECT row_to_json(s) FROM (
  SELECT id, key, value, label, created_at, updated_at, deleted_at
  FROM public.system_config WHERE key = 'credit_precheck_ai_enabled'
) s
\g :snapshot_file

UPDATE public.system_config
SET deleted_at = statement_timestamp(), updated_at = statement_timestamp()
WHERE key = 'credit_precheck_ai_enabled'
  AND value = 'false' AND deleted_at IS NULL
  AND updated_at = timestamp '2026-08-29 04:09:21.429'
RETURNING id, key, value, updated_at, deleted_at;

\if :apply
  COMMIT;
\else
  ROLLBACK;
  \echo 'Dry run rolled back. Snapshot contains the original row.'
\endif
