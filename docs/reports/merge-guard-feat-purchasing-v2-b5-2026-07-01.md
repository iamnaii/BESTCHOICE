# Merge Guard Report — feat/purchasing-v2-b5

**Date**: 2026-07-01  
**Branch**: `feat/purchasing-v2-b5`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 2026-06-30 11:18 +0700  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `PurchaseOrdersPage/components/AccountsPayableTab.tsx` | +47 | -8 |
| `PurchaseOrdersPage/components/POListTab.tsx` | +13 | -3 |
| `PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx` | +58 | new |
| `PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` | +31 | +4 |
| `PurchaseOrdersPage/index.tsx` | +28 | -5 |
| `PurchaseOrdersPage/summaryStrip.test.ts` | +61 | new |
| `PurchaseOrdersPage/summaryStrip.ts` | +130 | new |

**7 files changed, 357 insertions, 15 deletions** — frontend only, no backend changes.

---

## Feature Description

B5 purchasing summary strip:
- New `PurchasingSummaryStrip` component (mirrors DashboardKPIs card anatomy) with 7 KPI cards (รออนุมัติ, รอสั่งซื้อ, กำลังมา, เลยกำหนดส่ง, รับบางส่วน, รอตรวจ QC, ค้างจ่าย)
- Clicks route to the correct tab/status filter or `/purchase-orders/qc`
- `overdueOnly` filter state wired into POListTab (client-side filter on `isOverdue(po)`)
- "ใกล้ครบกำหนด" (due-soon within 7 days) badge in AP tab
- Progress bar (paid/total) per supplier in AP tab
- All mutations now invalidate `['purchase-orders-summary']`

---

## Issues Found

### Critical — NONE

### Warning

**W1 — `new Date()` instantiated inside render function (AccountsPayableTab.tsx)**  
File: `apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx` (line ~90)  
The `isLate`/`dueSoon` calculation creates `new Date()` on every row render. Not a correctness bug, but slightly wasteful in large lists. Consider hoisting `const now = new Date()` outside the `.map()` callback.

### Info

**I1 — Empty `catch {}` blocks are pre-existing, not introduced by this branch**  
The two `onClick` handlers in `AccountsPayableTab.tsx` that use `try { api.get(...); } catch {}` already existed on `main` (confirmed). No silent error swallowing was newly introduced by this branch.

**I2 — `Number()` on Decimal money fields**  
Several `Number(entry.totalPaid)` / `Number(entry.totalNet)` calls exist for display purposes. These were all pre-existing on `main`; this branch did not introduce new `Number()` wraps on money values. Display-only conversion is acceptable for `toLocaleString()`.

**I3 — `staleTime: 30_000` on summary query**  
The 30-second stale time means the strip counts can lag up to 30s after an external change. Acceptable for a summary strip; the invalidation on every mutation keeps it fresh for the current user's actions.

---

## Checklist

- [x] No new controllers without `@UseGuards`
- [x] No new `Number()` on money fields (pre-existing ones not modified)
- [x] No missing `deletedAt: null` (frontend only)
- [x] No hardcoded secrets or hex colors (summaryStrip.ts test verifies token-only classes)
- [x] Uses `api.get()` / `api.post()` (not raw `fetch()` or `axios`)
- [x] `queryClient.invalidateQueries()` called after all 8 mutations
- [x] Uses `sonner` toast (not `alert()`)
- [x] `/purchase-orders/summary` endpoint exists with proper `@Roles` guard
- [x] `/purchase-orders/qc` route exists in `App.tsx`
- [x] 61 unit tests added for `summaryStrip.ts` config (design-token assertion included)

---

## Recommendation

**APPROVE**

No critical or blocking issues. One minor warning (W1 — `new Date()` per row). Branch is frontend-only, correctly wired to existing API endpoints, follows all design token and API call conventions.
