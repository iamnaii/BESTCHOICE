# Retire the unused credit precheck setting (#1606)

Prepared 4 October 2026 following the owner's instruction to address the remaining work. This operation removes the obsolete setting from active configuration; it does not restore automatic credit checking. No application code reads this key.

Audited production row: `credit_precheck_ai_enabled`, value `false`, native PostgreSQL `updated_at=2026-08-29 04:09:21.429` (`timestamp without time zone`), `deleted_at=NULL`. The read-only connector serializes this timestamp as `2026-08-28T21:09:21.429Z` because its JavaScript driver interprets a timezone-free value in Bangkok time. SQL must compare the native database value, not that converted display. The scripts target only this key and refuse a changed, missing or already deleted row. They are manual operations, outside Prisma deployment migrations.

## Execute with a database operator connection

Use the intended database's authorized operator connection. The read-only BESTCHOICE MCP connection cannot execute these writes. Do not change its grants or put a write inside a read-only query. Keep connection credentials in the operator's environment; do not commit them.

From the repository root, create a private evidence directory, then dry-run:

```sh
umask 077
cleanup_evidence=$(mktemp -d /tmp/bestchoice-precheck-cleanup.XXXXXX)
psql "$DATABASE_URL" -X -A -t \
  -v snapshot_file="$cleanup_evidence/before-dry-run.json" \
  -f apps/api/prisma/migrations-manual/2026-10-04-credit-precheck-cleanup.sql
```

Inspect the original JSON and dry-run output. The script locks the row, records all fields, conditionally soft-deletes one row and rolls back by default. To commit that exact operation:

```sh
psql "$DATABASE_URL" -X -A -t -v apply=true \
  -v snapshot_file="$cleanup_evidence/before-apply.json" \
  -f apps/api/prisma/migrations-manual/2026-10-04-credit-precheck-cleanup.sql \
  > "$cleanup_evidence/committed-result.txt"
```

Require successful exit and `COMMIT`; retain the returned row ID and exact UTC cleanup timestamp. If a write/commit connection fails, read back before retrying: a successful server commit may have lost its acknowledgement. The script refuses a second deletion rather than refreshing the timestamp. Do not overwrite either snapshot with a retry.

Read back `key, value, updated_at, deleted_at` and confirm the same row has equal non-null deletion/update timestamps and value `false`. Also verify `TEST_MODE_BYPASS` is still `false`. An unexpected state is a stop-and-investigate result, not permission to broaden the WHERE clause.

## Conditional restore

Read the snapshot and committed result first. Provide the exact ID and deletion timestamp returned by the committed cleanup:

```sh
psql "$DATABASE_URL" -X -A -t \
  -v row_id='<ID from committed result>' \
  -v cleanup_at='<UTC timestamp from committed result>' \
  -f apps/api/prisma/migrations-manual/2026-10-04-credit-precheck-restore.sql
```

This also rolls back by default. Add `-v apply=true` only to perform the restore. The restore refuses a changed ID, value, update time or deletion time. It clears `deleted_at` and stamps a new `updated_at`; it never replaces other fields from an old snapshot. Verify the result by reading it back. Restoring this obsolete row still does not restore the retired feature.

## Evidence

Keep the before snapshot, committed result, readback and operator/time together outside source control. Local disposable PostgreSQL verification is separate from production execution; record each explicitly in the remaining-work evidence report.
