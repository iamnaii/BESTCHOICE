# Merge Guard Report — `feat/purchasing-v2-b5`

**Date**: 2026-07-01  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 2026-06-29  
**Recommendation**: ⚠️ REVIEW (1 Warning)

---

## File Changes Summary

| File | Change |
|------|--------|
| `PurchaseOrdersPage/components/AccountsPayableTab.tsx` | +51/-15 (UI polish) |
| `PurchaseOrdersPage/components/POListTab.tsx` | +13/-3 (overdueOnly filter) |
| `PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx` | +58 (new component) |
| `PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` | +31 (summary query + overdue state) |
| `PurchaseOrdersPage/index.tsx` | +28/-1 (wire summary strip) |
| `PurchaseOrdersPage/summaryStrip.test.ts` | +61 (new tests) |
| `PurchaseOrdersPage/summaryStrip.ts` | +130 (config/types) |

**Total**: 7 files changed, 357 insertions, 15 deletions (frontend only)

---

## What This Branch Does

- **PurchasingSummaryStrip**: 7-card KPI strip (pendingApproval / toOrder / incoming / overdue / receiving / waitingQc / unpaid) above the PO list. Each card clicks through to the relevant tab/filter. Matches DashboardKPIs anatomy with design tokens.
- **AP Tab polish**: paid-progress bar per supplier, "ใกล้ครบกำหนด" 7-day warning hint, row deep-link.
- **overdueOnly filter**: Filter chip + `isOverdue()` client-side predicate on POListTab.
- **Summary query**: `GET /purchase-orders/summary` at `staleTime: 30_000`, invalidated on every PO mutation.

---

## Issues Found

### Critical
None.

### Warning

**W1 — Silent `catch {}` swallows row-click errors** (`AccountsPayableTab.tsx`, row onClick and button onClick)

```tsx
// Row tr onClick (line ~90)
onClick={async () => {
  try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {}
}}
// Button onClick (line ~96)
onClick={async (e) => {
  e.stopPropagation();
  try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {}
}}
```

If the API call fails (network error, 403, 404) the user gets no feedback. Should at minimum `toast.error(getErrorMessage(err))` in the catch block to match the codebase's error-handling convention.

Note: this pattern already existed on the main branch (pre-B5 AccountsPayableTab had the same silent catch). B5 refactors it slightly but does not fix the underlying issue. Still surfacing it here for awareness.

### Info

**I1 — `Number()` on Decimal-typed display fields** (`AccountsPayableTab.tsx`)

`Number(entry.totalRemaining)`, `Number(entry.totalPaid)`, etc. are used for `toLocaleString()` display formatting. The frontend `PayableData` type already declares these as `number` (not `Prisma.Decimal`) — the API serialises Decimal → JSON number during the response. This is standard frontend display practice and acceptable. Not a financial calculation.

**I2 — Summary query uses defensive envelope unwrap** (`usePurchaseOrdersData.ts`, line ~113)

```ts
const summary = summaryRes
  ? ('pendingApproval' in summaryRes ? summaryRes : (summaryRes as { data?: PurchasingSummary }).data)
  : undefined;
```

Works correctly. Could be simplified once the backend API shape is confirmed stable.

---

## Verdict: REVIEW

No critical issues. One warning (silent catch) is a pre-existing pattern inherited from the main branch, not a regression introduced by B5. Safe to merge after confirming the silent-catch behaviour is acceptable for the AP tab row click (or after adding a `toast.error` fallback).
