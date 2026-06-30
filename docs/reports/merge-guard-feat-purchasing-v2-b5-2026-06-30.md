# Merge Guard Report — feat/purchasing-v2-b5

**Date**: 2026-06-30  
**Branch**: `origin/feat/purchasing-v2-b5`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Scope**: Frontend-only (no API changes)

---

## File Changes Summary

7 files changed, all within `apps/web/src/pages/PurchaseOrdersPage/`:

| File | Change |
|------|--------|
| `components/AccountsPayableTab.tsx` | Added loading state, paid-progress bar, due-soon hint (+7 lines), row deep-link |
| `components/POListTab.tsx` | Added `overdueOnly` filter prop + filter chip (+14 lines) |
| `components/PurchasingSummaryStrip.tsx` | **New file** — 7-card KPI strip (DashboardKPIs pattern) |
| `hooks/usePurchaseOrdersData.ts` | Added `summary` query, `overdueOnly` state, cache invalidations on all mutations |
| `index.tsx` | Wires `PurchasingSummaryStrip` + `onSummaryCardClick` navigation callback |
| `summaryStrip.ts` | **New file** — card config, tone styles, action types |
| `summaryStrip.test.ts` | **New file** — 6 unit tests covering keys, routing, tone-styles |

---

## Issues Found

### Critical
*None*

### Warning

**W1 — Defensive envelope type cast in `usePurchaseOrdersData.ts`**  
File: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts`

```ts
const { data: summaryRes } = useQuery<{ data?: PurchasingSummary } | PurchasingSummary>({...})
// Backend returns the bare object; tolerate a { data } envelope defensively.
const summary = summaryRes
  ? ('pendingApproval' in summaryRes ? summaryRes : (summaryRes as { data?: PurchasingSummary }).data)
  : undefined;
```

The comment says "backend returns the bare object" but the union type and runtime check defensively handles a `{ data }` envelope that doesn't exist. `api.get()` already unwraps Axios `response.data`, so `summaryRes` is always `PurchasingSummary | undefined`. The double-handling is harmless but adds runtime overhead and makes the type misleading.  
**Recommendation**: Simplify to `useQuery<PurchasingSummary>` — the defensive path can never be reached.

---

### Info

**I1 — Unit tests cover SUMMARY_CARDS but no integration test for the strip render**  
The 6 new unit tests in `summaryStrip.test.ts` are solid and cover the critical routing/token invariants. There is no rendering test for `PurchasingSummaryStrip.tsx` (confirming cards mount without crashing), but given the component is thin and the logic is in `summaryStrip.ts` (which is tested), this is acceptable.

**I2 — `navigate('/purchase-orders/qc')` hardcoded path in `index.tsx`**  
The QC center route is hardcoded in `onSummaryCardClick`. If the route ever changes, this will silently navigate to a 404. Low risk given current routing setup, but worth a constants extraction if routes are refactored.

---

## Positive Notes

- All mutations properly call `queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] })` — cache stays consistent.
- Design tokens only — no hardcoded hex/gray/white anywhere in new code.
- `summaryStrip.test.ts` explicitly verifies `TONE_STYLES` uses no hex colors or `bg-gray-*` / `bg-white` — guards against future drift.
- `aria-label` on every card button — a11y compliant.
- Uses `api.get()` from `@/lib/api` — not raw `fetch()`.
- No new API controller/endpoints introduced — purely frontend wiring to an already-guarded `GET /purchase-orders/summary` endpoint that existed in `main`.

---

## Recommendation: **APPROVE** (with W1 as optional cleanup)

The branch is safe to merge. No security issues, no missing guards (no API changes), no money-handling bugs. W1 is a code-clarity concern only — the defensive envelope logic can be simplified but does not affect correctness. The feature is well-tested.
