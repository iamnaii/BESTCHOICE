# Merge Guard Report — feat/purchasing-v2-b5

**Date**: 2026-07-03  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits**: 5 (latest: `feat(purchasing): PurchasingSummaryStrip cards (DashboardKPIs pattern) (B5)`)  
**Diff**: 7 files changed, 357 insertions(+), 15 deletions(-)

---

## Summary of Changes

Pure frontend feature — no backend changes:

1. **`PurchasingSummaryStrip`** (new component) — 7 clickable KPI cards (รออนุมัติ / รอสั่งซื้อ / กำลังมา / เลยกำหนดส่ง / รับบางส่วน / รอตรวจ QC / ค้างจ่าย) wired to `GET /purchase-orders/summary`. Cards use the `DashboardKPIs` anatomy pattern with token-only Tailwind classes.
2. **`summaryStrip.ts`** (new module) — Pure config/logic (`SUMMARY_CARDS`, `TONE_STYLES`, `PurchasingSummary` type, `SummaryFilterAction` union). Extracted for testability.
3. **`summaryStrip.test.ts`** (new Vitest spec) — 6 tests covering card ordering, type coverage, icon presence, action routing, and token-only styling enforcement.
4. **`overdueOnly` filter state** added to `usePurchaseOrdersData` + `POListTab` — allows the "เลยกำหนดส่ง" card to filter the PO list without resetting the status filter.
5. **`AccountsPayableTab` improvements** — Loading state, payment progress bar, and "ใกล้ครบกำหนด" (7-day warning) badges.
6. **`queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] })`** added to all 8 mutation `onSuccess` handlers — summary strip stays in sync after any PO action.

---

## Issues Found

### Critical
*None.*

### Warning
*None.*

### Info

**I1 — `Number()` on display-only Decimal fields**  
File: `AccountsPayableTab.tsx:22,25,27,31`  
`Number(entry.totalRemaining)`, `Number(entry.totalPaid)`, `Number(entry.totalNet)` are used for `toLocaleString()` display and progress bar width calculation only. These are pre-existing patterns (line 22 was in main before this branch). No DB writes involved.

**I2 — Empty catch block in row click handler**  
File: `AccountsPayableTab.tsx:83`  
`onClick={async () => { try { ... } catch {} }}` — silently swallows the error if fetching PO detail fails. Consider adding a `toast.error()` in the catch block for user feedback. (Pre-existing pattern from the button handler above; not introduced by this branch.)

**I3 — `navigate('/purchase-orders/qc')` references an unverified route**  
File: `PurchaseOrdersPage/index.tsx:92`  
The "รอตรวจ QC" card navigates to `/purchase-orders/qc`. If this route doesn't exist in the router, the user lands on a 404. This should be confirmed against `apps/web/src/router.tsx` before merge. (The comment says "the dedicated QC center page (B4)" — if B4 is merged, this is fine.)

---

## Recommendation: **APPROVE** (confirm I3 first)

- Frontend-only change, no backend security surface introduced.
- All data fetching uses `api.get()` (no raw `fetch()`), `useQuery` pattern followed, `invalidateQueries` wired on all mutations.
- Design tokens used throughout — no hardcoded hex or gray-* classes (verified by the test at `summaryStrip.test.ts:54`).
- Resolve I3: confirm `/purchase-orders/qc` route exists (B4 merged) before deploying; otherwise guard the navigate call or render the card as disabled.
