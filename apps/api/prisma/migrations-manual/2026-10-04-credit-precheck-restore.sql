-- Restore only the unchanged row produced by the paired cleanup operation.
\set ON_ERROR_STOP on
\if :{?row_id}
\else
  \echo 'Missing row_id from cleanup result.'
  DO $$ BEGIN RAISE EXCEPTION 'Precondition failed; no changes made.'; END $$;
\endif
\if :{?cleanup_at}
\else
  \echo 'Missing cleanup_at from committed cleanup result.'
  DO $$ BEGIN RAISE EXCEPTION 'Precondition failed; no changes made.'; END $$;
\endif
\if :{?apply}
\else
  \set apply false
\endif

BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT id FROM public.system_config
WHERE key = 'credit_precheck_ai_enabled' FOR UPDATE;
SELECT count(*) = 1 AND coalesce(bool_and(
  id = :'row_id' AND value = 'false'
  AND deleted_at = :'cleanup_at'::timestamp
  AND updated_at = :'cleanup_at'::timestamp
), false) AS matches_cleanup
FROM public.system_config WHERE key = 'credit_precheck_ai_enabled'
\gset
\if :matches_cleanup
\else
  ROLLBACK;
  \echo 'STOP: row no longer matches the committed cleanup; restore refused.'
  DO $$ BEGIN RAISE EXCEPTION 'Precondition failed; no changes made.'; END $$;
\endif

UPDATE public.system_config
SET deleted_at = NULL, updated_at = statement_timestamp()
WHERE key = 'credit_precheck_ai_enabled' AND id = :'row_id'
  AND value = 'false'
  AND deleted_at = :'cleanup_at'::timestamp
  AND updated_at = :'cleanup_at'::timestamp
RETURNING id, key, value, updated_at, deleted_at;
\if :apply
  COMMIT;
\else
  ROLLBACK;
  \echo 'Restore dry run rolled back.'
\endif
