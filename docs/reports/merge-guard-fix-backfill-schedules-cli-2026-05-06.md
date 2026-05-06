# Merge Guard Report — fix/backfill-schedules-cli

**Date:** 2026-05-06  
**Branch:** `fix/backfill-schedules-cli`  
**Author:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commit:** e77ffc03 — feat(api): backfill-schedules CLI for contracts activated before PR #753

---

## File Changes Summary

| File | Changed |
|------|---------|
| `apps/api/src/cli/backfill-installment-schedules.cli.ts` | 109 additions (new file) |
| `apps/api/package.json` | 2 additions, 1 deletion (new `backfill:schedules` script entry) |

**Scope:** API CLI only. No controller, no service, no Prisma schema change.

---

## What This Branch Does

Adds a one-shot idempotent CLI (`backfill-installment-schedules.cli.ts`) to generate missing `installment_schedules` rows for contracts activated before PR #753 (which introduced auto-generation on activation).

Key behaviors:
- Requires `EXPECTED_DB_NAME` env var — aborts on mismatch (DB safety guard)
- Skips contracts that already have schedule rows (`count > 0`)
- Uses `Prisma.Decimal` with correct rounding (`ROUND_DOWN` for principal, `ROUND_HALF_UP` for interest) matching `contract-workflow.service::generateInstallmentSchedules`
- Batch inserts via `createMany`
- Per-contract error isolation — one failure doesn't abort the run

---

## Issues

### Critical
_None found._

### Warning

1. **`workflowStatus: 'ACTIVE' as any` — incorrect field name / narrow filter**  
   The candidates query uses `workflowStatus: 'ACTIVE'` which does not match the actual Prisma schema field (the correct field is `status` of type `ContractStatus`). This means the query likely returns 0 rows in production (the field name is wrong) OR it silently falls back to a full scan depending on Prisma behavior with unknown fields.  
   Additionally, even if corrected to `status: 'ACTIVE'`, contracts in `OVERDUE`, `DEFAULT`, and `LEGAL` status also need backfill — they were also activated before PR #753.  
   **This bug is fixed in the follow-up branch `fix/backfill-status-filter`** (commit 72decb22). Both branches should be merged together, or this branch should be merged after `fix/backfill-status-filter`.

2. **`as any` type assertion on enum values**  
   The `workflowStatus: 'ACTIVE' as any` (and in the follow-up, `status: { in: [...] as any }`) bypasses TypeScript's enum type checking. Using proper `ContractStatus` enum imports would be safer:
   ```ts
   import { ContractStatus } from '@prisma/client';
   status: { in: [ContractStatus.ACTIVE, ContractStatus.OVERDUE, ContractStatus.DEFAULT, ContractStatus.LEGAL] }
   ```
   This is a CLI-only script so the risk is contained, but the type safety loss is worth noting.

3. **`prisma.$disconnect()` not called on early exit**  
   The top-level catch at the bottom calls `process.exit(1)` without `prisma.$disconnect()`. This is a minor resource leak, but acceptable for a CLI script (OS cleans up on exit).

### Info

1. **Good DB guard** — `EXPECTED_DB_NAME` check prevents accidental execution against wrong database. ✓  
2. **Idempotent** — `count` check before insert ensures safe re-runs. ✓  
3. **Correct Decimal rounding** — matches the production `generateInstallmentSchedules` logic. ✓  
4. **No hardcoded secrets or SQL injection** — all queries use Prisma ORM. ✓  
5. **`deletedAt: null` present** on both candidates query and `installmentSchedule.count`. ✓

---

## Recommendation: ⚠️ REVIEW

Merge **only together with `fix/backfill-status-filter`** (or after it). The `workflowStatus` field bug in the candidates query means contracts in `OVERDUE`/`DEFAULT`/`LEGAL` will be missed unless the follow-up fix is applied. Both branches together constitute a complete and safe implementation.

If merging independently, apply `fix/backfill-status-filter` first, then this branch.
