# Merge Guard Report — `fix/accounting-w2-w4-frontend`

**Date**: 2026-05-03  
**Branch**: `fix/accounting-w2-w4-frontend`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Last commit**: 2026-04-29 23:46:53 +0700  
**Recommendation**: ✅ APPROVE (after A2 + A3 are merged)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | +1 | 0 | Added 53-1805 Sales Discount on Interest (FINANCE) |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +7 | 0 | Added 53-1801 Sales Discount on Commission (SHOP) |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +21 | -15 | W-4 discount behavior test updates |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +99 | -37 | Phase W-4 explicit discount expense + Phase W-2 advisory lock |
| `apps/api/src/modules/receipts/receipts.service.ts` | +16 | -7 | Phase W-2 advisory lock for receipt number generation |
| `apps/web/src/App.tsx` | +9 | 0 | New route `/accounting/intercompany` |
| `apps/web/src/config/menu.ts` | +2 | 0 | Menu entries for ACCOUNTANT + OWNER |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | +287 | 0 | New page |

---

## Issues

### Critical
*None found.*

### Warning
*None found.*

### Info

**I-1: `Number(l.debit)` / `Number(l.credit)` in page display logic**
- **File**: `apps/web/src/pages/IntercompanySettlementPage.tsx:190–192`
- Used only to format journal line amounts for display in a history table. Not a financial calculation. Acceptable in UI context.

---

## Positive Observations

### Phase W-2 — Sequential Number Generation (advisory lock)
- Replaced `SELECT ... FOR UPDATE` with `pg_advisory_xact_lock(${lockKey}::bigint)` in both `journal-auto.service.ts` and `receipts.service.ts`
- Correctly fixes the race condition on first JE/receipt of each new month (previously `FOR UPDATE` had nothing to lock against)
- Lock key is server-generated (YYYYMM as integer, namespaced `1${YYYYMM}` for receipts) — not user-controlled, no injection risk ✓
- `$queryRaw` uses Prisma template literal parameterization ✓

### Phase W-4 — Explicit Discount Expense
- Discount on interest/VAT now creates a visible `Dr. 53-1805 Sales Discount on Interest` line rather than hiding it as Unearned/Income asymmetry ✓
- Commission discount creates `Dr. 53-1801 Sales Discount on Commission` on SHOP side ✓
- Legacy zero-breakdown fallback correctly avoids recognising interest/VAT income with no breakdown ✓
- `isLegacyFallback` guard prevents incorrect double-recognition ✓
- All arithmetic uses `Prisma.Decimal` throughout ✓

### IntercompanySettlementPage
- Uses `api.get()` / `api.post()` from `@/lib/api` ✓
- `useQuery` / `useMutation` / `useQueryClient` from React Query ✓
- `queryClient.invalidateQueries()` called after successful mutation (both `intercompany-balance` and `intercompany-history` keys) ✓
- `toast.success()` / `toast.error()` from `sonner` ✓
- `QueryBoundary` wrapping both data sections ✓
- No hardcoded hex colors; no `text-gray-*` / `bg-gray-*` / `bg-white` ✓
- Route protected with `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` ✓
- Page lazy-loaded via `React.lazy()` ✓
- 287 lines — within the 500-line threshold ✓

---

## Merge Order Note

This branch is the **third layer** of an explicit dependency chain:

```
fix/accounting-phase-a2-deferred-income   ← merge first
  └── fix/accounting-phase-a3-ic-settlement  ← merge second
        └── fix/accounting-w2-w4-frontend     ← merge last (this branch)
```

The `journal-auto.service.ts` diff index chain confirms sequential authoring. Attempting to merge this branch before A2/A3 will produce conflicts.
