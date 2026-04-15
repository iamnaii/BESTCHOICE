# Pre-Merge Guard Report: feat/accounting-audit-fixes

**Date**: 2026-04-15  
**Branch**: `feat/accounting-audit-fixes`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits ahead of main**: 9  
**Recommendation**: 🔴 BLOCK — fix 3 Critical issues before merge

---

## Commit Summary

| Hash | Message |
|------|---------|
| `9aba503` | fix(test): relax getContractPayments assertion |
| `973342e` | fix(test): update payment test mocks for R-012 |
| `d785a10` | feat(accounting): Thai accounting standards audit fixes |
| `bf32a3c` | feat: inter-company accounting (SHOP ↔ FINANCE) |
| `68529a9` | fix: address 5 critical issues from code review |
| `76b5b42` | feat(api): bulk LINE campaign with flex templates |
| `20f1742` | feat(api): inventory forecasting + reorder suggestions |
| `521f7e6` | feat(api): automated credit scoring + early warning |
| `9de7c73` | feat(web): global keyboard shortcuts + help overlay |

---

## Files Changed (TS/TSX, new/modified)

- `apps/api/src/modules/accounting/accounting.service.ts` — major changes
- `apps/api/src/modules/inter-company/inter-company.controller.ts` — new
- `apps/api/src/modules/inter-company/inter-company.service.ts` — new
- `apps/api/src/modules/inter-company/inter-company.module.ts` — new
- `apps/api/src/modules/inter-company/dto/inter-company.dto.ts` — new
- `apps/api/src/modules/inventory/inventory-forecast.controller.ts` — new
- `apps/api/src/modules/inventory/inventory-forecast.service.ts` — new
- `apps/api/src/modules/credit-check/credit-check.controller.ts` — modified
- `apps/api/src/modules/credit-check/credit-check.service.ts` — modified
- `apps/web/src/components/ShortcutsHelpOverlay.tsx` — new
- `apps/web/src/hooks/useGlobalShortcuts.ts` — new
- `apps/web/src/components/layout/MainLayout.tsx` — modified

---

## Issues

### 🔴 Critical (must fix before merge)

#### C-001 — `Number()` on Decimal financial fields in `accounting.service.ts`
**File**: `apps/api/src/modules/accounting/accounting.service.ts`  
**Commit**: `d785a10`  
**Lines (approx)**: multiple in `getIncomeStatement` and `getBalanceSheet`

At least **15 instances** of `Number()` called directly on Prisma `Decimal` fields and `_sum` aggregates:

```ts
// WRONG — violates Decimal money rule
installmentPayments += Number(p.amountPaid);
interestIncome += Number(p.contract.interestTotal) / p.contract.totalMonths;
lateFeeIncome += Number(p.lateFee);
expMap[e.category] = (expMap[e.category] || 0) + Number(e.totalAmount);
const grossReceivables = Number(hpReceivables._sum.amountDue || 0);
const paidOnReceivables = Number(hpReceivables._sum.amountPaid || 0);
const allowanceForDoubtful = Number(provisions._sum.provisionAmount || 0);
// ... 8 more instances
```

**Fix**: Use `new Prisma.Decimal(value || 0)` for sums, `.toNumber()` only at the final serialisation boundary (JSON response), or restructure with `Decimal` arithmetic throughout:

```ts
// CORRECT
import { Prisma } from '@prisma/client';
const gross = new Prisma.Decimal(hpReceivables._sum.amountDue ?? 0);
```

#### C-002 — `Number()` on Decimal profit fields in `inter-company.service.ts`
**File**: `apps/api/src/modules/inter-company/inter-company.service.ts`  
**Commit**: `bf32a3c`

8 instances in `getProfitSummary`:

```ts
// WRONG
const shopProfit   = Number(t.shopProfit);
const financeProfit = Number(t.financeProfit);
const commission   = Number(t.commission);
const interestTotal = Number(t.interestTotal);
const costPrice    = Number(t.costPrice);
const vatAmount    = Number(t.vatAmount);
const downPayment  = Number(t.downPayment);
const principal    = Number(t.principal);
```

These are all `@db.Decimal(12,2)` fields. Converting to `Number` loses precision for large amounts (>2^53 cents).

**Fix**: Use `Prisma.Decimal` arithmetic and only call `.toNumber()` when building the final JSON response object.

#### C-003 — Missing `deletedAt: null` in `product.findMany` (accounting service)
**File**: `apps/api/src/modules/accounting/accounting.service.ts`  
**Commit**: `d785a10`

```ts
// WRONG — bundles query does not filter soft-deleted products
const bundleProducts = await this.prisma.product.findMany({
  where: { id: { in: allBundleIds } },   // ← no deletedAt: null
  select: { costPrice: true },
});
```

A soft-deleted bundle product will be included in cost calculations, producing inflated COGS figures.

**Fix**:
```ts
where: { id: { in: allBundleIds }, deletedAt: null },
```

---

### 🟡 Warning (should fix)

#### W-001 — `Number()` on Decimal fields in `credit-check.service.ts`
**File**: `apps/api/src/modules/credit-check/credit-check.service.ts`  
**Commit**: `20f1742`

```ts
const monthlyPayment = creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0;
const monthlySalary  = customer.salary ? Number(customer.salary) : 0;
```

`monthlyPayment` and `salary` are `Decimal` fields. While these are used for a ratio calculation (DTI score), precision loss is still undesirable.

**Fix**: Use `Prisma.Decimal` for the arithmetic then call `.toNumber()` only for the final score comparison.

---

### 🔵 Info

#### I-001 — New controllers properly guarded ✅
All 3 new controllers pass security checks:

| Controller | `@UseGuards` | `@Roles` on all methods |
|-----------|-------------|------------------------|
| `InterCompanyController` | `JwtAuthGuard, RolesGuard` | ✅ `OWNER / ACCOUNTANT` |
| `InventoryForecastController` | `JwtAuthGuard, RolesGuard` | ✅ `OWNER / BRANCH_MANAGER` |
| `GlobalCreditCheckController` (extended) | inherited | ✅ all roles present |

#### I-002 — No hardcoded secrets detected ✅
No hardcoded API keys or credentials found in the diff.

#### I-003 — Test updates look correct ✅
`payments.service.spec.ts` relaxes `getContractPayments` assertion to match updated query — appropriate.

---

## Action Required

1. Fix **C-001**: Replace all `Number(x)` calls in `accounting.service.ts` financial calculations with `Prisma.Decimal` arithmetic.
2. Fix **C-002**: Replace all `Number(t.*)` in `inter-company.service.ts` `getProfitSummary` with `Prisma.Decimal`.
3. Fix **C-003**: Add `deletedAt: null` to the `bundleProducts.findMany` query.
4. Address **W-001**: Use `Prisma.Decimal` for DTI ratio calculation in `credit-check.service.ts`.
