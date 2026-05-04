# Merge Guard Report — `phase-a4-cpa-chart-adoption`

**Date**: 2026-05-04  
**Branch**: `phase-a4-cpa-chart-adoption`  
**Author**: Akenarin Kongdach  
**Recommendation**: 🟡 **REVIEW** — large PR, one type-safety issue in production code

---

## File Changes Summary

97 files changed, 10 218 insertions(+), 4 950 deletions(-)

This is the Phase A.4 CPA chart adoption — the largest of the three branches reviewed. It replaces the A.0-A.3 dead code, adopts the 99-account FINANCE chart, and wires caller sites (payments, contracts, paysolutions, repossessions, bad-debt, expense, IC, defect) to CPA templates.

### Selected new production files (largest)
| File | Lines |
|------|-------|
| `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b-split.template.ts` | 251 |
| `apps/api/src/modules/journal/__tests__/scenario-helpers.ts` | 227 |
| `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts` | 205 |
| `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts` | 204 |
| `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts` | 177 |
| `apps/api/src/modules/journal/cpa-templates/reschedule-jp6.template.ts` | 156 |
| `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts` | 126 |

All new files are under 300 lines. No file exceeds the 500-line guideline. ✅

---

## Issues Found

### 🔴 Critical

None found.

- No new controllers added (only existing controllers modified with new routes)
- All new endpoints on `AccountingController` are under the existing class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` and each has `@Roles(...)` ✅
- No `Number()` on financial fields in production templates (Decimal arithmetic throughout)
- No `$queryRawUnsafe` or unparameterized SQL
- No hardcoded secrets or credentials
- All modified `findFirst`/`findMany` calls in service code include `deletedAt: null` ✅

---

### ⚠️ Warning

#### W1 — `(tx.contract as any).update` in production reschedule code

**File**: likely `apps/api/src/modules/contracts/` or `reschedule.service.ts`  
**Lines**: ~2495 in diff

```ts
await (tx.contract as any).update({
  ...
});
```

This casts a Prisma transaction client member to `any` to call `.update()`. If the Prisma schema type for `contract` within the transaction type does not expose `update`, this is a type error being suppressed rather than fixed. The `as any` cast bypasses TS type checking and could silently pass wrong data shape.

**Fix**: Use the correctly typed `tx.contract.update(...)` — if `update` is not on the type, check that the PrismaService transaction type is properly inferred. Do not suppress with `as any` in production service code.

#### W2 — `inst12AmountDue` cast via `(inst12.amountDue as any).toString()`

**Lines**: ~2405 in diff

```ts
const inst12AmountDue = new Decimal((inst12.amountDue as any).toString());
```

`amountDue` is a `Decimal` field from Prisma — it should have a `.toString()` method directly without the `as any` cast. The cast suggests this field's type is not being correctly narrowed. 

**Fix**: Use `inst12.amountDue.toString()` directly, or the project's `d()` helper: `d(inst12.amountDue)`.

#### W3 — Input validation missing on new `ledger/*` endpoints

**File**: `apps/api/src/modules/accounting/accounting.controller.ts`

```ts
@Get('ledger/profit-loss')
getProfitLossFromJournal(
  @Query('periodStart') periodStart: string,
  @Query('periodEnd') periodEnd: string,
) {
  const start = new Date(periodStart);  // no validation
  const end = new Date(periodEnd);      // no validation
```

`new Date(undefined)` → `Invalid Date`, which will propagate silently into the service query. A missing or malformed date string will not return a meaningful error.

**Fix**: Add `@IsDateString()` DTO validation or a guard that checks `isNaN(start.getTime())` and throws `BadRequestException` with a Thai message.

---

### ℹ️ Info

#### I1 — Pervasive `prisma as any` in spec files

All new spec files (`payment-receipt-2b.template.spec.ts`, `early-payoff-jp4.template.spec.ts`, `reschedule-jp6.template.spec.ts`, etc.) use `prisma as any` to pass the Prisma client to template constructors. This is the established test pattern for this module and is acceptable.

#### I2 — PR scope is large (97 files, ~10K lines)

This is expected for a chart-of-accounts adoption. The diff is primarily:
- Removal of A.0-A.3 dead code (~4 950 deletions)
- New CPA templates + their spec files
- Migration + seed files
- Spec documentation

No single production service file appears excessively large.

#### I3 — New `RescheduleModule` properly registered ✅

`RescheduleModule` exports `RescheduleService` and only imports `PrismaModule`. Module registration in `app.module.ts` appears correct.

#### I4 — All accounting report endpoints restricted to financial roles ✅

`ledger/trial-balance`, `ledger/profit-loss`, `ledger/balance-sheet` are restricted to `OWNER`, `FINANCE_MANAGER`, `ACCOUNTANT`. No SALES or BRANCH_MANAGER access to raw ledger data.

#### I5 — `chart-of-accounts` endpoint now includes `SALES` role

`@Get('/')` and `@Get('by-codes')` on `ChartOfAccountsController` were expanded from `['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']` to also include `SALES`. This is intentional (CashAccountSelect dropdown in POS) but should be confirmed with the owner that SALES seeing the full chart of accounts is acceptable.

---

## Recommendation

**🟡 REVIEW**

No critical security or data-integrity blockers. Fixes needed before merge:

1. **W1** — Remove `(tx.contract as any).update` — use properly typed transaction call
2. **W2** — Remove `(inst12.amountDue as any).toString()` — use `d()` helper or direct `.toString()`
3. **W3** — Add date-string validation on `ledger/profit-loss` query params

Confirm **I5** (SALES access to chart-of-accounts) with owner before merge.
