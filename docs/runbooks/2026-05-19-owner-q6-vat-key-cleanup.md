# Runbook — Owner Q6 VAT legacy-key cleanup

**Trigger:** Owner Response Q6 (signed 2026-05-17)
**Owner:** akenarin.ak
**Status:** Ready to execute — owner-verified VAT_RATE first, then soft-delete legacy keys

---

## What this runbook does

Owner Response Q6 directs us to soft-delete the SystemConfig legacy keys
`vat_pct` + `vat_rate` once `VAT_RATE` (canonical) is confirmed to hold
the intended percentage value. After cleanup, the `[D1.1.3.1]` WARN-log
"Found legacy vat_pct alongside VAT_RATE" stops firing on app boot.

The SQL was already drafted under D1.1.3.1 (May 2026) — this runbook
just sequences the existing scripts.

## Pre-flight (~2 min)

Run from a host with `DATABASE_URL` pointing at the target environment.

```bash
psql "$DATABASE_URL" -c "SELECT key, value, deleted_at IS NOT NULL AS soft_deleted
FROM system_config
WHERE key IN ('VAT_RATE', 'vat_pct', 'vat_rate')
ORDER BY key;"
```

Expected output:
- `VAT_RATE` row present with `value = '7'` (or whatever rate is in effect)
  + `soft_deleted = false`
- Possibly `vat_pct` row with `value = '0.07'` or `'7'` (legacy) + `soft_deleted = false`
- Possibly `vat_rate` row with `value = '0.07'` (older legacy) + `soft_deleted = false`

⚠ **STOP and call CPA** if any of these are true:
- `VAT_RATE` row is missing.
- `VAT_RATE` value looks wrong (e.g. `'0.7'` interpreted as 70%; `'1.0'` interpreted as 1%).
- `vat_pct` / `vat_rate` values differ in ways that suggest someone edited one but not the other.

In any of those cases, run the backfill first
(`2026-05-17-merge-vat-rate-keys.sql`) — it's the safer path because it
infers `VAT_RATE` from `vat_pct` with explicit operator confirmation.

## Step 1 (only if `VAT_RATE` is missing)

```bash
psql "$DATABASE_URL" \
  -f apps/api/prisma/migrations-manual/2026-05-17-merge-vat-rate-keys.sql
# Prompts for: YES_BACKFILL_VAT
```

This INSERTs a `VAT_RATE` row computed from `vat_pct` (or `vat_rate`).
Legacy keys remain in place — they get cleaned up in step 2.

## Step 2 — soft-delete legacy keys (Owner Q6 main action)

```bash
psql "$DATABASE_URL" \
  -f apps/api/prisma/migrations-manual/2026-05-17-cleanup-vat-pct-orphan.sql
# Prompts for: YES_CLEANUP_VAT_PCT
```

Internal effect: one `UPDATE system_config SET deleted_at = NOW() WHERE
key IN ('vat_pct', 'vat_rate') AND deleted_at IS NULL`. Idempotent —
re-runs are no-ops. Soft-delete (NOT hard-delete) — values stay
recoverable for emergency revert.

## Verification (~2 min)

```bash
# 1. Confirm legacy keys are soft-deleted, canonical key is alive
psql "$DATABASE_URL" -c "SELECT key, value, deleted_at IS NOT NULL AS soft_deleted
FROM system_config
WHERE key IN ('VAT_RATE', 'vat_pct', 'vat_rate')
ORDER BY key;"

# Expected:
#  VAT_RATE | 7    | f   ← alive
#  vat_pct  | …    | t   ← soft-deleted
#  vat_rate | …    | t   ← soft-deleted

# 2. Trigger the orphan-key check (deploys a fresh app boot or just re-runs the bootstrap).
#    Look for the [D1.1.3.1] WARN message in logs — should be ABSENT after cleanup.
#    Pattern that was firing pre-cleanup:
#      "[D1.1.3.1] Found legacy vat_pct/vat_rate alongside VAT_RATE — please…"
```

## Rollback (if Owner discovers value drift after the fact)

```sql
UPDATE system_config
SET deleted_at = NULL, updated_at = NOW()
WHERE key IN ('vat_pct', 'vat_rate')
  AND deleted_at IS NOT NULL;
```

This restores the rows; `VAT_RATE` will continue to be the primary read
path because `vat-rate.util.ts:89-95` prefers it. The WARN log will
resume firing until the legacy rows are removed (or until `VAT_RATE` is
brought into agreement with them).

## After this runbook

- Memory note: project_owner_response_q1_q8_2026_05_17.md → mark Q6 as DONE.
- No code change required — InterestConfigPage (frontend) already writes
  to `VAT_RATE` only since D1.1.3.1 follow-up, so legacy keys won't
  regenerate.

## References

- Owner Response v2.0 (signed 2026-05-17), Q6
- `apps/api/src/utils/vat-rate.util.ts` — canonical read order (VAT_RATE → vat_pct → vat_rate → 7%)
- `apps/api/src/utils/vat-rate-bootstrap.service.ts` — emits the WARN log this cleanup quiets
- `apps/api/prisma/migrations-manual/2026-05-17-cleanup-vat-pct-orphan.sql` — the SQL this runbook invokes
- `apps/api/prisma/migrations-manual/2026-05-17-merge-vat-rate-keys.sql` — fallback backfill (Step 1)
