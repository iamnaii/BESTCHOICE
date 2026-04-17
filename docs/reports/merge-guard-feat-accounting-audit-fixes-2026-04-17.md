# Pre-Merge Guard Report — `feat/accounting-audit-fixes`

**Date**: 2026-04-17  
**Branch**: `feat/accounting-audit-fixes`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Reviewer**: Pre-Merge Guard (automated)

---

## Branch Summary

- **Unique commits (not in main)**: 4 commits at tip
- **Behind main by**: 50 commits (Facebook integration, inbox redesign, and other changes not included)
- **Key changes**: Inter-company accounting module (SHOP↔FINANCE), accounting audit fixes (Chart of Accounts, bad-debt provisioning, balance sheet, cash flow), 2 test-fix commits

### Top Unique Commits
| Commit | Message |
|--------|---------|
| `9aba503d` | fix(test): relax getContractPayments assertion to match updated query |
| `973342e8` | fix(test): update payment test mocks for R-012 findMany idempotency change |
| `d785a107` | feat(accounting): Thai accounting standards audit fixes (7 critical, 14 warnings, 15 recommendations) |
| `bf32a3c3` | feat: inter-company accounting (BESTCHOICE SHOP ↔ BESTCHOICE FINANCE) |

### File Changes Summary (unique commits)
- `apps/api/src/modules/inter-company/inter-company.controller.ts` — new controller (73 lines)
- `apps/api/src/modules/inter-company/inter-company.service.ts` — new service (264 lines)
- `apps/api/src/modules/inter-company/dto/inter-company.dto.ts` — new DTOs (108 lines)
- `apps/api/src/modules/accounting/accounting.controller.ts` — added balance-sheet, cash-flow, bad-debt, period-lock endpoints
- `apps/api/src/modules/accounting/accounting.service.ts` — balance sheet and cash flow report methods
- `apps/api/prisma/seeds/chart-of-accounts.ts` — 76-account Thai SME chart of accounts seed
- `apps/web/src/pages/DashboardPage.tsx` — entity profit widget

---

## Issues Found

### 🔴 Critical (Must Fix Before Merge)

#### C-1: `Number()` on Prisma Decimal money fields — `inter-company.service.ts` (bf32a3c3)
**File**: `apps/api/src/modules/inter-company/inter-company.service.ts`  
**Rule**: Money fields must use `Prisma.Decimal` arithmetic, never `Number()`

The profit summary method converts all Decimal fields to JS `Number` before arithmetic:
```typescript
const shopProfit = Number(t.shopProfit);
const financeProfit = Number(t.financeProfit);
const commission = Number(t.commission);
const interestTotal = Number(t.interestTotal);
const costPrice = Number(t.costPrice);
const vatAmount = Number(t.vatAmount);
const downPayment = Number(t.downPayment);
const principal = Number(t.principal);
// Also: totalLateFees = Number(lateFeeAgg._sum.lateFee || 0)
```
This causes floating-point rounding errors on financial totals. All arithmetic on these fields must use `Prisma.Decimal` or `new Decimal(value)`.

#### C-2: `Number()` on Prisma Decimal money fields — `accounting.service.ts` (d785a107)
**File**: `apps/api/src/modules/accounting/accounting.service.ts`  
**Rule**: Money fields must use `Prisma.Decimal` arithmetic, never `Number()`

Balance sheet and cash flow methods:
```typescript
bundleCost = bundleProducts.reduce((sum, p) => sum + Number(p.costPrice || 0), 0);
const purchaseOrderCost = productCosts.reduce((sum, s) => sum + Number(s.product.costPrice || 0), 0);
const grossReceivables = Number(hpReceivables._sum.amountDue || 0);
const paidOnReceivables = Number(hpReceivables._sum.amountPaid || 0);
const allowanceForDoubtful = Number(provisions._sum.provisionAmount || 0);
const financeReceivables = Number(pendingFinance._sum.expectedAmount || 0);
// And multiple more in cash flow statement
```
`costPrice`, `amountDue`, `amountPaid`, `provisionAmount`, `expectedAmount` are all `@db.Decimal(12,2)` fields.

---

### 🟡 Warning (Should Fix)

#### W-1: Missing `deletedAt: null` on bundle products query
**File**: `apps/api/src/modules/accounting/accounting.service.ts`  
```typescript
where: { id: { in: allBundleIds } },  // missing deletedAt: null
```
Product model has soft-delete. This query may return deleted bundle products in COGS calculations.

#### W-2: Some `@IsNumber()` decorators missing Thai error messages
**File**: `apps/api/src/modules/inter-company/dto/inter-company.dto.ts`  
Several `@IsNumber()` decorators have no `{ message }` option:
```typescript
@IsNumber()    // ← no Thai message
interestTotal: number;
```
Convention: all validation messages must be in Thai.

#### W-3: Branch is 50 commits behind `main`
The branch diverged before the following main changes were added:
- Facebook Messenger integration (`feat: add Facebook data-deletion + deauthorize webhook endpoints`)
- Inbox redesign (`feat(inbox): full-bleed layout`)
- Integration Hub / SMS consolidation
This will require a substantial rebase or merge before this branch can land cleanly.

---

### 🔵 Info

#### I-1: `inter-company.service.ts` is 264 lines — approaching 300-line guideline
Consider splitting report/aggregation logic into a separate `InterCompanyReportsService`.

#### I-2: New `accounting.controller.ts` is long (adds ~80 lines)
Balance sheet / cash flow / bad-debt endpoints could be split into a dedicated `ReportsController`.

---

## Verdict

**🔴 BLOCK — Do not merge**

Two critical `Number()` violations on Decimal money fields exist in financial report services. These will produce floating-point rounding errors in balance sheet totals, entity profit summaries, and COGS calculations — directly impacting financial accuracy. Fix C-1 and C-2 before merge.

### Recommended fix pattern
```typescript
import { Prisma } from '@prisma/client';

// Instead of:
const shopProfit = Number(t.shopProfit);
const total = shopProfit + financeProfit;

// Use:
const shopProfit = new Prisma.Decimal(t.shopProfit ?? 0);
const total = shopProfit.plus(new Prisma.Decimal(t.financeProfit ?? 0));
// Serialize to number only at the JSON response boundary:
return { shopProfit: shopProfit.toNumber() };
```
