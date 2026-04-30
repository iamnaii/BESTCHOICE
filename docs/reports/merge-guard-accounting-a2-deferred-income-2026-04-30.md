# Merge Guard Report — fix/accounting-phase-a2-deferred-income

**Date**: 2026-04-30  
**Branch**: `fix/accounting-phase-a2-deferred-income`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 2 (feat + post-review fix)  
**Recommendation**: ✅ **APPROVE**

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/prisma/migrations/20260616000000_add_unearned_income_fields/migration.sql` | +25 | New Decimal columns + backfill |
| `apps/api/prisma/schema.prisma` | +7 | `unearnedInterest`, `unearnedCommission` on Contract model |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +9/-1 | Seeds unearned fields at contract activation |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +213/-96 | Deferred recognition: activation defers, payment recognises |
| `apps/api/src/modules/payments/payments.service.ts` | +3/-3 | Passes `contract.id` to payment JE (3 call sites) |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | +2/-1 | Same fix for PaySolutions webhook path |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | +1 | Adds `contract.id` to data audit context |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +7/-1 | Adds account `21-2201` (Unearned Commission SHOP) |
| Test files (spec.ts) | +266 | New/updated tests for deferred lifecycle |

**Total**: 10 files, +452 insertions, -96 deletions

---

## Issues Found

### Critical — None

### Warning

**W1 — `unearnedInterest`/`unearnedCommission` decrement has no floor check**  
`apps/api/src/modules/journal/journal-auto.service.ts`

```typescript
data: {
  ...(interest.gt(0) ? { unearnedInterest: { decrement: interest } } : {}),
  ...(commission.gt(0) ? { unearnedCommission: { decrement: commission } } : {}),
},
```

If a manual adjustment or edge-case double-posting causes more decrements than the original seeded amount, the denormalized counter goes negative. The JE posting itself is correct regardless (the Unearned ledger account is the source of truth), so accounting is not corrupted — only the contract-level reporting field. Should add `GREATEST(0, unearned_interest - ?)` at the DB level or add a guard.

**W2 — `contract.storeCommission ?? 0` uses JS number 0 for a Decimal field**  
`apps/api/src/modules/contracts/contract-workflow.service.ts:64`

```typescript
unearnedCommission: contract.storeCommission ?? 0,
```

`contract.storeCommission` is `Prisma.Decimal | null`. The `?? 0` fallback passes a JS `number` to a `@db.Decimal(12,2)` field. Prisma coerces this correctly, but it's inconsistent with the project rule of never using JS numbers for money. Should use `new Prisma.Decimal(contract.storeCommission ?? 0)` or `contract.storeCommission ?? new Prisma.Decimal(0)`.

### Info

**I1 — Zero-value deferred Dr lines included in JE for zero-interest payments**

When `monthlyInterest = 0` and `monthlyCommission = 0`, the payment JE still includes:
```
Dr Unearned Interest  0
Dr VAT_OUTPUT_PENDING 0
```
These are no-op lines that add noise to the JE without accounting effect. Not a bug, but a minor code style concern.

**I2 — Migration backfill uses an approximation heuristic**

```sql
GREATEST(0, c."interest_total" - COALESCE(SUM(p."monthly_interest") FROM payments ...))
```

This is a reasonable approximation for existing contracts (the comment acknowledges it). Works correctly for standard cases. Edge cases (manual adjustments, amended payments) may leave a small discrepancy in the denormalized counter, but the ledger (Phase A.2 accounts) will be accurate once new payments post. Acceptable for a greenfield Phase A.2 rollout.

---

## Positive Observations

- ✅ Migration includes proper backfill SQL for ACTIVE/OVERDUE/DEFAULT contracts — no data gap
- ✅ All new Decimal fields use `@db.Decimal(12, 2)` — correct
- ✅ Payment JE balances correctly: Dr (Cash + Unearned Interest + VAT Pending) = Cr (HP Receivable + Interest Income + Late Fee + VAT Output)
- ✅ End-to-end lifecycle test (`full contract: activation + 12 payments`) verifies all deferred accounts drain to 0
- ✅ Inter-company invariant test (SHOP Due-from == FINANCE Due-to) included
- ✅ `payments.service.ts` correctly passes `contract.id` to JE at all 3 call sites
- ✅ `paysolutions.service.ts` webhook path also receives `contract.id`
- ✅ `deletedAt: null` filters present throughout

---

## Merge Ordering Constraint

This branch must be merged **before** `fix/accounting-phase-a3-ic-settlement` and `fix/accounting-w2-w4-frontend`. Both downstream branches depend on the `unearnedInterest`/`unearnedCommission` schema fields and the new account constants (`UNEARNED_COMMISSION`, `UNEARNED_INTEREST`, `VAT_OUTPUT_PENDING`) added here.

**Merge order: A2 → A3 → W2-W4**
