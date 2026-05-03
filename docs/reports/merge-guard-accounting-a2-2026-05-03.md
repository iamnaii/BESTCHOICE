# Merge Guard Report — `fix/accounting-phase-a2-deferred-income`

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a2-deferred-income`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Last commit**: 2026-04-29 21:30:43 +0700  
**Recommendation**: ✅ APPROVE (with noted items)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `prisma/migrations/20260616000000_add_unearned_income_fields/migration.sql` | +25 | 0 | New migration |
| `apps/api/prisma/schema.prisma` | +7 | 0 | Two new Decimal fields on Contract |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +10 | -1 | Added 21-2201 Unearned Commission (SHOP) |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +13 | -1 | Seeds unearned fields at activation |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | +4 | -4 | Test update to match new activation data |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | +1 | 0 | Passes `contract.id` to journal service |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +213 | -96 | Phase A.2 deferred recognition model |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +266 | -43 | Extensive test updates + lifecycle tests |
| `apps/api/src/modules/payments/payments.service.ts` | +3 | -3 | Passes `contract.id` to createPaymentJournal (×3 call sites) |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | +3 | -1 | Passes `contract.id` to createPaymentJournal |

---

## Issues

### Critical
*None found.*

### Warning

**W-1: Migration timestamp is out of chronological order**
- **File**: `apps/api/prisma/migrations/20260616000000_add_unearned_income_fields/migration.sql`
- **Issue**: Migration is dated `20260616` (June 16, 2026) but today is 2026-05-03. Any migration added between now and June 16 will be sorted _before_ this one by `prisma migrate deploy`, potentially breaking the expected schema order if those future migrations depend on the `unearned_interest` / `unearned_commission` columns.
- **Recommendation**: Rename the migration directory to use today's date: `20260503000000_add_unearned_income_fields`.

### Info

**I-1: `breakdownSum.abs().toNumber() > 0.02` — numeric tolerance check**
- **File**: `apps/api/src/modules/journal/journal-auto.service.ts`
- `.toNumber()` is used _only_ for comparing against a tolerance threshold (0.02), not for any financial computation. Acceptable use.

**I-2: `unearnedCommission: contract.storeCommission ?? 0`**
- **File**: `apps/api/src/modules/contracts/contract-workflow.service.ts`
- `storeCommission` is a Prisma `Decimal` field. Passing `?? 0` (JS number) is safe since Prisma accepts numeric literals for Decimal fields.

---

## Positive Observations

- All new queries include `deletedAt: null` ✓
- `contract.unearnedInterest/unearnedCommission` decremented using `Prisma.Decimal` via `{ decrement: interest }` — no raw number arithmetic ✓
- New columns added as `NOT NULL DEFAULT 0` with a backfill UPDATE — correct two-step migration pattern ✓
- Backfill query uses `deleted_at IS NULL` filter ✓
- 266 test lines added including a full lifecycle invariant test (activation + 12 payments → deferred accounts drain to 0) ✓
- Early payoff: `unearnedInterest: 0, unearnedCommission: 0` zeroed out on contract close ✓

---

## Merge Order Note

This branch is the **base layer**. `fix/accounting-phase-a3-ic-settlement` and `fix/accounting-w2-w4-frontend` both depend on changes introduced here. Merge this first.
