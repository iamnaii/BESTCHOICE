# Merge Guard Report — fix/accounting-w2-w4-frontend

**Date**: 2026-04-30  
**Branch**: `fix/accounting-w2-w4-frontend`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 1  
**Recommendation**: ✅ **APPROVE** (after A2 + A3 are merged)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | +1 | Account `53-1805` (Sales Discount on Interest, FINANCE) |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +7 | Account `53-1801` (Sales Discount on Commission, SHOP) |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +99/-7 | W-2: pg_advisory lock; W-4: explicit discount expense lines |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +21/-8 | Updated tests for W-4 discount model |
| `apps/api/src/modules/receipts/receipts.service.ts` | +16/-8 | W-2: pg_advisory lock for receipt number generation |
| `apps/web/src/App.tsx` | +9 | Lazy route `/accounting/intercompany` → `IntercompanySettlementPage` |
| `apps/web/src/config/menu.ts` | +2 | Menu item in ACCOUNTANT + OWNER configs |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | +287 | New settlement UI page |

**Total**: 8 files, +405 insertions, -37 deletions

---

## Issues Found

### Critical — None

### Warning

**W1 — History panel uses `/journal-entries` endpoint with client-side substring filtering**  
`apps/web/src/pages/IntercompanySettlementPage.tsx:429-437, 462-464`

```typescript
const historyQ = useQuery({
  queryFn: async () =>
    (await api.get('/journal-entries', {
      params: { search: 'IC_SETTLEMENT', limit: 50 },
    })).data,
});

const settlementHistory = (historyQ.data?.data ?? []).filter(
  (e) => e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท'),
);
```

The `/journal-entries` endpoint likely does a full-text `search` across multiple fields, not a `referenceType = 'IC_SETTLEMENT'` filter. It will return journal entries whose description, entry number, or reference contains the string "IC_SETTLEMENT" — which may include unrelated entries or miss IC settlement entries entirely depending on the endpoint's search implementation.

The client-side `.filter()` on description is a secondary guard, but 287 lines of a page returning wrong history data would be a confusing UX. **Low security risk, High functional risk.**

**Recommended fix**: Add a dedicated API endpoint `GET /accounting/intercompany/history` that queries `JournalEntry` directly with `referenceType = 'IC_SETTLEMENT'`, instead of relying on the generic journal search.

### Info

**I1 — Zero-value Dr lines in legacy early-payoff fallback path**  
`apps/api/src/modules/journal/journal-auto.service.ts`

In the `isLegacyFallback` branch (`sumOtherOrig = 0`, old contracts with no breakdown), the FINANCE JE still includes:
```
Dr Unearned Interest  0.00   (sumInterestOrig = 0 in legacy case)
Dr VAT_OUTPUT_PENDING 0.00   (sumVatOrig = 0 in legacy case)
```
These are no-ops but add noise to the posted JE. Low priority — could be addressed by filtering zero lines before posting.

**I2 — W-4 in-place mutation of financeLines array entries**  
`apps/api/src/modules/journal/journal-auto.service.ts`

```typescript
if (isLegacyFallback) {
  const hpLine = financeLines.find((l) => l.accountCode === FA.HP_RECEIVABLE)!;
  hpLine.credit = sumRemainingDue.toNumber();  // mutates in-place
  ...
}
```

The code constructs `financeLines` then mutates individual entries by reference. Functionally correct but harder to read than reconstructing the array. Very minor style concern.

**I3 — Branch depends on A3 being merged first**

`IntercompanySettlementPage.tsx` calls `GET /accounting/intercompany/balance` and `POST /accounting/intercompany/settle` — endpoints that are only registered in `fix/accounting-phase-a3-ic-settlement`. Merging this branch before A3 would result in 404s on the new page.

---

## Positive Observations

**W-2 (pg_advisory_xact_lock):**
- ✅ Correctly replaces `SELECT ... FOR UPDATE` for sequence generation — the old approach couldn't lock when no rows existed yet (first JE/receipt of a new month was a race condition)
- ✅ Lock keys are namespaced: journals use raw YYYYMM (`202604`), receipts use `1YYYYMM` (`1202604`) — no collision
- ✅ `pg_advisory_xact_lock` auto-releases at transaction commit/rollback — no orphan locks

**W-4 (explicit discount expense):**
- ✅ Discount is now a visible P&L line (`ส่วนลดให้ลูกค้า`) instead of hidden in Unearned/Income asymmetry
- ✅ SHOP + FINANCE IC invariant maintained after discount: `Dr Due-to-SHOP (FINANCE) = Cr Due-from-FINANCE (SHOP)` for commission discount portion
- ✅ JE balances verified algebraically for both discount and no-discount cases

**Frontend page:**
- ✅ Uses `useQuery` / `useMutation` from React Query — no raw `fetch()`
- ✅ `queryClient.invalidateQueries()` called on both `intercompany-balance` and `intercompany-history` after successful settlement
- ✅ `toast.success()` / `toast.error()` from sonner — no `alert()`
- ✅ Page wrapped in `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}`
- ✅ Lazy-loaded via `React.lazy()`
- ✅ Semantic tokens throughout (`bg-muted`, `text-muted-foreground`, `border-border`) — no hardcoded hex

---

## Required Before Merge

1. Merge `fix/accounting-phase-a2-deferred-income` first (schema + account constants)
2. Merge `fix/accounting-phase-a3-ic-settlement` with W1+W2 fixes applied
3. (Recommended) Fix W1: add a dedicated `/accounting/intercompany/history` endpoint instead of reusing generic journal search

**Merge order: A2 → A3 (fixed) → W2-W4**
