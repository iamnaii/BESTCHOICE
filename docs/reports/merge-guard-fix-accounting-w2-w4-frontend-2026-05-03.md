# Merge Guard Report — fix/accounting-w2-w4-frontend

**Date**: 2026-05-03  
**Branch**: `fix/accounting-w2-w4-frontend`  
**Diverges from**: `1a7bdef5` (feat: Phase A.3 W-5 — on main)  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard Agent  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | +1 | Add `53-1805` Sales Discount on Interest (FINANCE) |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +7 | Add `53-1801` Sales Discount on Commission (SHOP) |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +/-21 | Update tests for W-4 explicit discount model |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +/-99 | W-2: advisory lock + W-4: explicit discount P&L lines |
| `apps/api/src/modules/receipts/receipts.service.ts` | +/-16 | W-2: advisory lock for receipt number generation |
| `apps/web/src/App.tsx` | +9 | Route for `/accounting/intercompany` |
| `apps/web/src/config/menu.ts` | +2 | Menu entry for OWNER and ACCOUNTANT |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | +287 | New page — IC settlement UI |

**Total**: 405 insertions, 37 deletions across 8 files.

---

## What This Branch Does

### W-2 — Concurrent JE/Receipt Number Race Fix
Replaces `SELECT ... FOR UPDATE` with `pg_advisory_xact_lock(YYYYMM::bigint)` in both `journal-auto.service.ts` and `receipts.service.ts`. The old `FOR UPDATE` could race on the *first* entry of a new month (no rows to lock yet). The advisory lock serialises all callers within a month prefix even when the table is empty. Receipt lock key is namespaced `1YYYYMM` to avoid colliding with JE locks.

### W-4 — Explicit Discount Expense (P&L Visibility)
Early-payoff JEs now post discount as an explicit `Dr. Sales Discount Interest (53-1805)` + `Dr. Sales Discount Commission (53-1801)` rather than hiding the discount as an income asymmetry (Unearned drain > Income recognised). Makes discount visible to CPA reporting.

### Frontend — Intercompany Settlement Page
New `/accounting/intercompany` page showing FINANCE's outstanding balance to SHOP and allowing settlement recording via dialog. Accessible to `OWNER`, `FINANCE_MANAGER`, `ACCOUNTANT`.

---

## Issues Found

### Critical
None.

### Warning

**W1 — `parseFloat(amount)` for API payload** (`IntercompanySettlementPage.tsx:447`)
```typescript
amount: parseFloat(amount),  // amount is a string from <input type="number">
```
`parseFloat` can produce floating-point imprecision (e.g., `parseFloat('1.005')` → `1.005000000000001`). The backend DTO validates `@IsNumber({ maxDecimalPlaces: 2 })` which would reject this. In practice, `<input type="number" step="0.01">` constrains user input, so real-world impact is low. Safer: `Math.round(parseFloat(amount) * 100) / 100` before sending.

**W2 — Two-step line mutation in legacy fallback** (`journal-auto.service.ts:199–225`)
```typescript
const interestIncomeCredit = isLegacyFallback ? interestActual : sumInterestOrig;
// ... adds line with interestIncomeCredit to financeLines array ...
if (isLegacyFallback) {
  financeLines.find(FA.INTEREST_INCOME)!.credit = 0;  // then overrides it to 0
}
```
The pattern works (tests confirm) but the initial assignment for the legacy path (`interestActual`) is dead — it's always overridden. Could be simplified by skipping the initial assignment on the legacy path. No functional impact.

**W3 — Account code `53-1801` used in both SA and FA** (`journal-auto.service.ts:40,100`)
```typescript
SA.SALES_DISCOUNT_COMMISSION = '53-1801'  // SHOP chart
FA.COMMISSION_EXPENSE        = '53-1801'  // FINANCE chart
```
Same code in two different entity charts for different purposes. Currently safe (separate `companyId` contexts). Could confuse future multi-entity reporting if a query aggregates across companies without filtering by `companyId`. Document or rename to reduce confusion.

### Info

**I1 — Settlement history filter relies on description format** (`IntercompanySettlementPage.tsx:462-464`)
```typescript
const settlementHistory = (historyQ.data?.data ?? []).filter(
  (e) => e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท'),
);
```
Client-side filter on the `description` field of JEs fetched via `search: 'IC_SETTLEMENT'`. If the IC settlement description template changes, the history list silently empties. Consider filtering by `referenceType: 'IC_SETTLEMENT'` server-side instead.

**I2 — New page is 287 lines** — within the 500-line guideline.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ N/A (no new controller in this branch; controller added in A.3 branch already on main) |
| `@Roles()` on all methods | ✅ Route guarded via `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` |
| `Number()` on money fields | ✅ None — `.toNumber()` used only for JE line serialisation, not DB writes |
| `deletedAt: null` in new queries | ✅ No new `findMany`/`findFirst` in service layer on this branch |
| Hardcoded secrets | ✅ None |
| `$queryRaw` injection | ✅ Advisory lock uses parameterised template literal (`${lockKey}::bigint`) |
| Frontend uses `api.get()`/`api.post()` | ✅ No raw `fetch()` |
| `queryClient.invalidateQueries()` after mutations | ✅ Both `intercompany-balance` and `intercompany-history` invalidated |
| Semantic design tokens (no hardcoded colors) | ✅ Uses `bg-muted`, `text-muted-foreground`, `border-border`, `text-primary` |
| Thai leading for text | ✅ `leading-snug` present on amount display |
