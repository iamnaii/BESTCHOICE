# Merge Guard Report — fix/backfill-status-filter

**Date:** 2026-05-06  
**Branch:** `fix/backfill-status-filter`  
**Author:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commit:** 72decb22 — fix(cli): use ContractStatus enum (not workflowStatus) for active filter

---

## File Changes Summary

| File | Changed |
|------|---------|
| `apps/api/src/cli/backfill-installment-schedules.cli.ts` | 1 addition, 1 deletion |

**Scope:** 1-line fix in an existing CLI. No other files touched.

---

## What This Branch Does

Corrects the Prisma query in `backfill-installment-schedules.cli.ts`:

```diff
- workflowStatus: 'ACTIVE' as any,
+ status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'LEGAL'] as any },
```

This fixes two bugs introduced in `fix/backfill-schedules-cli`:
1. **Wrong field name** — `workflowStatus` does not exist on the `Contract` model; the correct field is `status`.
2. **Incomplete filter** — only `ACTIVE` was included; contracts in `OVERDUE`, `DEFAULT`, and `LEGAL` were activated and also need schedule backfill.

---

## Issues

### Critical
_None found._

### Warning

1. **`as any` type assertion still used**  
   `['ACTIVE', 'OVERDUE', 'DEFAULT', 'LEGAL'] as any` bypasses TypeScript enum checking. Recommend replacing with proper `ContractStatus` enum imports from `@prisma/client`. Low-risk for a CLI, but worth cleaning up if the file gets further edits.

### Info

1. **`deletedAt: null` preserved** — The existing soft-delete filter is not disturbed. ✓  
2. **Correct field name** — `status` is the actual `ContractStatus` Prisma field on `Contract`. ✓  
3. **Correct scope** — `ACTIVE | OVERDUE | DEFAULT | LEGAL` covers all contracts that were activated (and thus need schedules) but are not yet closed/cancelled. ✓

---

## Recommendation: ✅ APPROVE

Correct, minimal fix. Should be merged before or together with `fix/backfill-schedules-cli` since it fixes a critical query bug in that branch. No security or data-integrity concerns.
