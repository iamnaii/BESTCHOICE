# Merge Guard Report — fix/accounting-w2-w4-frontend

**Date**: 2026-05-03  
**Branch**: `fix/accounting-w2-w4-frontend`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | +1 | 0 | Adds 53-1805 (Sales Discount on Interest) to FINANCE chart |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +7 | 0 | Adds 53-1801 (Sales Discount on Commission) to SHOP chart |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +74 | -37 | W-4 explicit discount expense; W-2 pg_advisory_xact_lock |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +20 | -12 | Tests updated for W-4 discount visibility |
| `apps/api/src/modules/receipts/receipts.service.ts` | +16 | -11 | W-2: pg_advisory_xact_lock for receipt number |
| `apps/web/src/App.tsx` | +9 | 0 | Adds `/accounting/intercompany` route |
| `apps/web/src/config/menu.ts` | +2 | 0 | Adds menu items for OWNER + ACCOUNTANT |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | +287 | 0 | New page: IC balance display + settlement form |

**Total**: 8 files, +416 insertions / -60 deletions

---

## Issues by Severity

### Critical
_None found._

### Warning

**W1 — Dead assignment creates misleading control flow in legacy fallback path**  
File: `apps/api/src/modules/journal/journal-auto.service.ts`, `createEarlyPayoffJournal`

```typescript
// Assigned here:
const interestIncomeCredit = isLegacyFallback ? interestActual : sumInterestOrig;

// Used to build financeLines:
{ accountCode: FA.INTEREST_INCOME, ..., credit: interestIncomeCredit.toNumber() },

// Then immediately overridden inside the if-block:
if (isLegacyFallback) {
  const interestLine = financeLines.find((l) => l.accountCode === FA.INTEREST_INCOME)!;
  interestLine.credit = 0;  // ← overwrites interestIncomeCredit
  ...
}
```

When `isLegacyFallback` is true, `interestIncomeCredit` is set to `interestActual` and written into `financeLines`, then the block **immediately zeroes it out**. The initial assignment for the legacy branch is dead code and the accompanying comment (`// credit Interest Income for the whole nonPrincipal`) contradicts the actual effect. This will confuse future maintainers.

Fix: build the `financeLines` array **after** the legacy/non-legacy branch decision, or set `interestIncomeCredit = new Prisma.Decimal(0)` in the legacy case upfront.

**W2 — Settlement history filtered client-side via fragile description string matching**  
File: `apps/web/src/pages/IntercompanySettlementPage.tsx`

```typescript
// historyQ fetches journal-entries?search=IC_SETTLEMENT&limit=50
// then client-side:
const settlementHistory = (historyQ.data?.data ?? []).filter(
  (e) => e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท'),
);
```

Filtering by `description` string is fragile — any change to the description template in `journal-auto.service.ts` will silently break this list. Since settlement JEs are posted with `referenceType: 'IC_SETTLEMENT'`, the backend API (or a dedicated endpoint) should filter by `referenceType` server-side and return only settlement entries. The client should not parse description strings to classify JE types.

### Info

**I1 — SHOP chart 53-1801 collision: `SALES_DISCOUNT_COMMISSION` vs `COMMISSION_EXPENSE` on FINANCE**  
File: `apps/api/src/modules/journal/journal-auto.service.ts`

Both `JournalAutoService.SHOP_ACC.SALES_DISCOUNT_COMMISSION` and `JournalAutoService.FINANCE_ACC.COMMISSION_EXPENSE` map to account code `'53-1801'`. These are in separate company charts so there is no conflict at runtime — but the constant naming (`COMMISSION_EXPENSE` on FINANCE for what appears to be an inter-company commission expense account) may cause confusion when reading the FINANCE-side account map. Cosmetic only; no functional issue.

**I2 — `pg_advisory_xact_lock` key namespace**  
File: `apps/api/src/modules/receipts/receipts.service.ts`

The receipt lock key uses `parseInt('1' + yyyymm, 10)` to distinguish from the journal entry lock (raw `yyyymm`). The comment explains the namespace separation. For 2026-04 this produces `1202604` (safe, well under `bigint` range). Good defensive coding — no issue, documenting for awareness.

**I3 — `IntercompanySettlementPage.tsx` is 287 lines**  
Comfortably under the 500-line split threshold. No action needed.

---

## Security Checks

| Check | Result |
|-------|--------|
| New route `/accounting/intercompany` uses `ProtectedRoute` | ✅ `roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` |
| Frontend uses `api.get()` / `api.post()` (no raw `fetch`) | ✅ Present throughout |
| `queryClient.invalidateQueries()` after mutations | ✅ Both `intercompany-balance` and `intercompany-history` invalidated |
| Toast from `sonner` only | ✅ No `alert()` / `confirm()` |
| `QueryBoundary` on data fetches | ✅ Both queries wrapped |
| Hardcoded hex colors | ✅ None — all semantic tokens (`bg-muted`, `border-border`, `text-muted-foreground`) |
| `Number()` on financial fields in backend | ✅ None — all `Prisma.Decimal` |
| `$queryRaw` injection | ✅ All uses are parameterized tagged-template-literals |

---

## Recommendation: ⚠️ REVIEW

Fix **W1** (dead assignment / misleading comment in legacy fallback) — this is a code clarity issue that will cause confusion in future accounting changes. Fix **W2** (client-side description filtering) by switching to a `referenceType`-based server query — fragile string matching on a critical financial history list is not acceptable long-term.

**Merge order dependency**: Requires `fix/accounting-phase-a2-deferred-income` and `fix/accounting-phase-a3-ic-settlement` merged first.

---

## Suggested Merge Order (all 3 branches)

```
1. fix/accounting-phase-a2-deferred-income   ← Phase A.2 (deferred recognition)
2. fix/accounting-phase-a3-ic-settlement     ← Phase A.3 (IC settlement JE + endpoint)
3. fix/accounting-w2-w4-frontend             ← W-2 (lock) + W-4 (discount) + frontend
```
