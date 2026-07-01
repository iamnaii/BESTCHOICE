# Pre-Merge Guard Report

**Branch**: `feat/purchasing-v2-b5`
**Author**: iamnaii <akenarin.ak@gmail.com>
**Date**: 2026-07-01
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +/- | Type |
|------|-----|------|
| `apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx` | +55 / -14 | Frontend |
| `apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx` | +12 / -4 | Frontend |
| `apps/web/src/pages/PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx` | +58 / 0 | Frontend (new) |
| `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` | +42 / -5 | Frontend |
| `apps/web/src/pages/PurchaseOrdersPage/index.tsx` | +28 / -5 | Frontend |
| `apps/web/src/pages/PurchaseOrdersPage/summaryStrip.ts` | +130 / 0 | Frontend (new) |
| `apps/web/src/pages/PurchaseOrdersPage/summaryStrip.test.ts` | +61 / 0 | Tests (new) |

**7 files changed, 357 insertions(+), 28 deletions(-)** — Frontend only, no backend changes.

**Key changes:**
- New `PurchasingSummaryStrip` card row (7 KPI cards: รออนุมัติ, รอสั่งซื้อ, กำลังมา, เลยกำหนดส่ง, รับบางส่วน, รอตรวจ QC, ค้างจ่าย)
- `overdueOnly` filter state wired into `usePurchaseOrdersData` + `POListTab`
- AP tab: loading state, paid progress bar, due-soon `≤7d` hint, row-level deep-link to PO detail
- `queryClient.invalidateQueries(['purchase-orders-summary'])` added after every mutation (7 mutation handlers updated)
- Unit tests covering card key coverage, action routing, design-token compliance

---

## Issues by Severity

### Critical (0)
None.

### Warning (1)

**W1 — Silent `catch {}` blocks on row click handler**
- File: `apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx` (lines +75, +82)
- Pattern: `onClick={async () => { try { ... } catch {} }}` — errors are swallowed silently.
- The `<tr>` row and inner `<button>` both share the same silent-catch pattern (pre-existing on the button, newly added on the `<tr>`).
- Should call `toast.error(getErrorMessage(err))` in the catch block so the user knows when a PO detail fetch fails.
- This is a UX and debuggability concern, not a security issue.

### Info (1)

**I1 — `Number(raw?.total)` cast in `usePurchaseOrdersData`**
- File: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` (line ~116)
- `total` is a record count (non-financial), so `Number()` is acceptable here. No `Prisma.Decimal` concern.

---

## Pattern Compliance

| Check | Result |
|-------|--------|
| `api.get()` / `api.post()` only (no raw `fetch`) | ✅ |
| `queryClient.invalidateQueries()` after all mutations | ✅ (7/7) |
| Design tokens only (no hardcoded hex / `bg-gray-*` / `bg-white`) | ✅ |
| `toast.success()` / `toast.error()` from sonner | ⚠️ W1 above (missing on catch) |
| React Query for data fetching (no raw `useEffect` + `fetch`) | ✅ |
| Thai UI labels | ✅ |
| Unit tests for new config module | ✅ (`summaryStrip.test.ts` — 5 test cases) |

---

## Recommendation: ⚠️ REVIEW

One Warning: fix the silent `catch {}` on the row/button click to surface errors to the user. Otherwise the branch is clean and follows all established patterns. Can be merged after fixing W1 or accepting the pre-existing silent-catch pattern.
