# Merge Guard Report — feat/p3-sp5-shop-accounting

**Date**: 2026-05-18  
**Branch**: `feat/p3-sp5-shop-accounting`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

---

## File Changes Summary

37 files changed, +4234/−28. Key additions:

| File | Lines |
|------|-------|
| `apps/web/src/pages/ShopAccountingPage.tsx` | +410 |
| `cpa-templates/shop-inventory-transfer.template.ts` | +337 |
| `modules/accounting/accounting.service.ts` | +215 |
| `modules/journal/paired-journal.service.ts` | +164 |
| `modules/accounting/accounting.service.spec.ts` | +164 |
| 6 SHOP JE template files | ~150 each |
| 8 spec files for SHOP templates | ~100 each |
| `apps/api/prisma/seed-coa-shop.ts` | +85 |
| `apps/web/src/config/menu.ts` | +24 |
| `apps/web/src/App.tsx` | +13 |

---

## Context

Phase 3 SP5 — SHOP-side accounting. Adds the SHOP half of the dual-entity chart:
- ~50 SHOP accounts with `S`-prefix codes in the same `chart_of_accounts` table
- 7 new JE templates covering the SHOP installment lifecycle (down-payment, activation/inventory-transfer, cash-sale, trade-in, expense, finance-receipt, cancellation)
- `PairedJournalService` for atomic SHOP + FINANCE journal pairs
- `CompanyResolverService` as single source of truth for `companyCode → companyId`
- `AccountingService` extended with `scope=FINANCE|SHOP|ALL` for multi-scope Trial Balance / P&L
- `ShopAccountingPage.tsx` (Trial Balance + P&L, date pickers, QueryBoundary)

---

## Issues by Severity

### Critical
_None found._

### Warning

**W-1 — Route role mismatch: `BRANCH_MANAGER` included in App.tsx but excluded everywhere else**

File: `apps/web/src/App.tsx` (line ~744)

```tsx
<ProtectedRoute
  roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}
>
  <ShopAccountingPage />
</ProtectedRoute>
```

`BRANCH_MANAGER` is present in the frontend route guard, but:
- API `@Roles` on both `/ledger/shop/trial-balance` and `/ledger/shop/profit-loss` is `OWNER, FINANCE_MANAGER, ACCOUNTANT` — no `BRANCH_MANAGER`
- `menu.ts` explicitly excludes BM from this path (per W5 policy, comment says "would 403 on click")
- `accounting.md` documents: "BRANCH_MANAGER is INTENTIONALLY excluded from these endpoints"

**Effect**: A `BRANCH_MANAGER` who navigates directly to `/shop/accounting` sees the page skeleton but every data call returns 403. The `QueryBoundary` will surface an error state. No security breach (API enforces roles correctly), but a confusing UX gap.

**Fix**: Remove `'BRANCH_MANAGER'` from the `roles` array in App.tsx for this route.

---

### Info

**I-1 — `Number()` on `netIncome` for CSS class only**

File: `apps/web/src/pages/ShopAccountingPage.tsx`

```tsx
Number(query.data.netIncome) >= 0 ? 'text-success' : 'text-destructive'
```

`Number()` on a Decimal-serialized string to decide a CSS color class. Not a money calculation; no precision loss risk. Acceptable, but could use `new Prisma.Decimal(query.data.netIncome).gte(new Prisma.Decimal(0))` for consistency with Decimal conventions in the codebase.

**I-2 — `any` types in test helpers**

`shop-templates/test-helpers.ts` and a few spec files use `let prisma: any` — standard Jest mock pattern, acceptable in test context only.

**I-3 — `ShopAccountingPage.tsx` at 410 lines**

Exceeds the soft 400-line guideline. The two tabs (Trial Balance, P&L) could each become a sub-component. Not blocking, but worth splitting in a follow-up.

**I-4 — `ShopInventoryTransferTemplate` at 337 lines**

The complexity is justified (2-JE atomic transaction with COGS + revenue + down-clearance + invariant assertion). No split needed.

---

## Recommendation

**REVIEW — Fix W-1 before merge**

One change required:

```diff
- roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}
+ roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}
```

in `apps/web/src/App.tsx` for the `/shop/accounting` route. All other code is solid — security guards correct, money uses `Prisma.Decimal` throughout, `deletedAt: null` consistently applied, no raw SQL, no hardcoded secrets.
