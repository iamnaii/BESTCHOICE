# Merge Guard Report — feat/purchasing-v2-b5

**Date**: 2026-07-01  
**Author**: iamnaii  
**Branch**: `feat/purchasing-v2-b5`  
**Commits**: 5 — AP tab polish, summary strip, overdueOnly filter

---

## File Changes Summary

| File | Changes | Type |
|------|---------|------|
| `PurchaseOrdersPage/components/AccountsPayableTab.tsx` | +51 / -8 | UI polish |
| `PurchaseOrdersPage/components/POListTab.tsx` | +13 / -1 | overdueOnly filter prop |
| `PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx` | +58 / 0 | New component |
| `PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` | +31 / 0 | summary query + overdueOnly state |
| `PurchaseOrdersPage/index.tsx` | +28 / -7 | Wire strip + navigate |
| `PurchaseOrdersPage/summaryStrip.test.ts` | +61 / 0 | New tests |
| `PurchaseOrdersPage/summaryStrip.ts` | +130 / 0 | New card config |
| **Total** | 7 files, 357 insertions, 15 deletions | Frontend only |

---

## Issues

### Critical
_None_

### Warning

**W1 — `Number()` on API money fields (display context) — AccountsPayableTab.tsx**  
`Number(entry.totalRemaining)`, `Number(entry.totalPaid)`, `Number(entry.totalNet)` are used in `.toLocaleString()` formatting and for the paid-progress bar percentage. These values come from the API as Prisma Decimal serialised as strings. The `Number()` conversion is display-only (no write-back to DB), and `Number()` is the standard frontend formatting path. However, the project convention explicitly warns against `Number()` on financial values. Consider extracting a `toDisplayNumber(v: unknown): number` util that is self-documenting and centralises the conversion.  
**Impact**: Display-only — no data loss; no DB write.

### Info

**I1 — Defensive shape detection in `usePurchaseOrdersData.ts`**  
```ts
const summary: PurchasingSummary | undefined = summaryRes
  ? ('pendingApproval' in summaryRes ? summaryRes : (summaryRes as { data?: PurchasingSummary }).data)
  : undefined;
```
The inline duck-type guard is fragile. If the backend ever adds a `data` envelope, the guard is wrong. A backend type assertion (or `zod` parse) at the query boundary would be safer. Low risk for now since the endpoint is under the same codebase.

**I2 — `SummaryFilterAction` panel action navigates hardcoded path**  
`navigate('/purchase-orders/qc')` in `onSummaryCardClick` — the path is not a constant. If the QC-center route changes, this will silently break. Consider importing from the central route constants.

---

## Audit Trail

**Security** — Frontend only. No new API endpoints. All API calls go through `api.get()` (correct).  
**Money** — No financial writes. Display-only `Number()` conversions noted above (W1).  
**Soft-delete** — No Prisma queries.  
**Design tokens** — `TONE_STYLES` verified: no hex, no `bg-white`, no `-gray-` (test already asserts this).  
**Cache invalidation** — `purchase-orders-summary` query key is invalidated after every mutation that could change counts. ✅  
**Tests** — `summaryStrip.test.ts` covers 5 scenarios including the design-token rule and action routing.

---

## Recommendation: ✅ APPROVE

No blocking issues. W1 and I1/I2 are quality notes for follow-up; none prevent safe merge. Tests are thorough.
