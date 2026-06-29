# Merge Guard Report — feat/purchasing-v2-b5

**Date**: 2026-06-29  
**Reviewer**: Pre-Merge Guard (automated)  
**Branch reviewed**: `feat/purchasing-v2-b5`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Last commit**: 2026-06-29 19:10 +07  
**Prior guard reports**:
- `docs/reports/merge-guard-feat-purchasing-v2-2026-06-29.md` — covers b0+b1
- `docs/reports/merge-guard-feat-purchasing-v2-b2-b3-b4-2026-06-29.md` — covers b2+b3+b4

---

## Branch Overview

B5 is the final batch of the **Purchasing v2** series. It is **frontend-only** — no new backend controllers, services, or DTOs were added in this batch. The 5 commits add a dashboard KPI strip and overdue filter to the PO list page.

| Branch | Commits | Files changed (incremental vs b4) | Focus |
|--------|---------|-----------------------------------|-------|
| `feat/purchasing-v2-b5` | 5 | 7 | Summary strip (KPI cards), overdueOnly filter, AP tab UX polish |

**Merge order**: b0 → b1 → b2 → b3 → b4 → **b5** (stacked; each requires prior branch).

---

## File Change Summary (b5 incremental, vs b4)

| File | Change | Notes |
|------|--------|-------|
| `components/AccountsPayableTab.tsx` | +43 / -8 | Loading state, paid progress bar, due-soon warning chip, row click → detail |
| `components/POListTab.tsx` | +13 / -1 | Accepts `overdueOnly` / `setOverdueOnly` props, filters list, filter chip |
| `components/PurchasingSummaryStrip.tsx` | +58 (new) | 7-card KPI strip following DashboardKPIs anatomy |
| `hooks/usePurchaseOrdersData.ts` | +31 | Adds `summary` query (`GET /purchase-orders/summary`), `overdueOnly` state, summary invalidation on all mutations |
| `index.tsx` | +28 / -1 | Mounts `<PurchasingSummaryStrip>`, routes card clicks to status/tab/overdue filters |
| `summaryStrip.ts` | +130 (new) | Card config, tone styles, `SummaryFilterAction` discriminated union |
| `summaryStrip.test.ts` | +61 (new) | Vitest unit tests: key coverage, routing logic, token-only class assertion |

---

## Issues Found

### 🔴 CRITICAL — Carry-forward (must fix before merging the b0–b5 stack)

These bugs were flagged in the b0+b1 report and remain unfixed through b5. B5 does not touch `po-receiving.service.ts`, so they persist unchanged.

#### C1 — `totalAmount` computed with float arithmetic for Decimal DB field
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:313`  
**Code**:
```ts
const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
// ...
const po = await tx.purchaseOrder.create({
  data: { ..., totalAmount, netAmount: totalAmount }
});
```
**Impact**: `PurchaseOrder.totalAmount` / `netAmount` are `Decimal @db.Decimal(12, 2)`. Summation via `Number()` risks floating-point imprecision on large quantities or non-round unit prices.  
**Fix**:
```ts
import { Prisma } from '@prisma/client';
const totalAmount = dto.items.reduce(
  (s, i) => s.plus(new Prisma.Decimal(i.unitPrice).times(i.quantity)),
  new Prisma.Decimal(0),
);
```

#### C2 — `costPrice: Number(poItem.unitPrice)` writes float to Decimal DB field
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:179`  
**Code**:
```ts
costPrice: Number(poItem.unitPrice),
```
**Impact**: `Product.costPrice` is `Decimal @db.Decimal(12, 2)`. Wrapping with `Number()` loses Prisma Decimal precision.  
**Fix**: `costPrice: poItem.unitPrice` (Prisma Decimal passes through directly without wrapping).

---

### 🟡 WARNING — New in b5

#### W1 — Empty `catch {}` blocks suppress errors silently in AP tab row-click
**File**: `apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx:85, 89`  
**Code**:
```ts
onClick={async () => { try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {} }}
```
**Issue**: If the API call fails (network error, 403, 404), the user clicks the row and nothing happens — no error toast, no feedback. The outer `try/catch` predates b5 (existing pattern), but b5 duplicates it on the `<tr>` row click without adding any feedback.  
**Fix**: Add `toast.error(getErrorMessage(err))` in the catch block, consistent with how mutations handle errors elsewhere in the file.

#### W2 — `Number()` on Decimal-origin AP totals (display only, but inconsistent)
**File**: `apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx:52, 54, 60, 115–117`  
**Code**:
```ts
{(Number(entry.totalRemaining) || 0).toLocaleString()}
style={{ width: `${Math.min((Number(entry.totalPaid) / Number(entry.totalNet)) * 100, 100)}%` }}
```
**Severity**: Warning only — these values come from the API as numbers (the AP query casts via `_sum`) and are display-only (not persisted). However, the pattern is inconsistent with the codebase norm of using `Prisma.Decimal` until the display layer. If the API ever returns string-formatted Decimals, `Number()` would silently truncate.  
**Fix**: Consider using `parseFloat(String(entry.totalRemaining))` or ensuring the API returns `number` explicitly in the DTO response type.

---

### ℹ️ INFO

#### I1 — `summaryStrip.ts` lacks a `useQcPendingCount` fallback for the `waitingQc` card
**File**: `apps/web/src/pages/PurchaseOrdersPage/summaryStrip.ts`  
**Note**: The `waitingQc` count in the summary strip comes from `GET /purchase-orders/summary` (B0 endpoint). A separate `useQcPendingCount` hook (added in B4) polls the same data from a different endpoint. On first mount, both may be loading simultaneously. The current implementation gracefully shows `null` (renders nothing) during loading — acceptable, but worth noting if counts diverge.

#### I2 — `PurchasingSummaryStrip` has no skeleton loader during initial fetch
**File**: `apps/web/src/pages/PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx:13`  
**Note**: Returns `null` when `summary` is undefined (loading). This causes a layout shift when the 7-card strip appears. Low priority, but a skeleton grid would improve perceived performance.

#### I3 — `setStatusFilterAndResetOverdue` helper could be confusing alongside `setStatusFilter`
**File**: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts:328`  
**Note**: The hook now exposes both `setStatusFilter` (raw) and `setStatusFilterAndResetOverdue` (resets overdueOnly). `index.tsx` passes the latter to `POListTab` which is correct. Future callers should use the compound version to maintain consistency.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 2 | Carry-forward from b0 — unfixed in b5 |
| 🟡 Warning | 2 | New in b5 (W1 silent errors, W2 display Number()) |
| ℹ️ Info | 3 | Low priority notes |

**B5 itself is clean** — frontend-only, no new backend endpoints, all API calls use `api.get()`/`api.post()`, React Query used correctly, design tokens respected (no hardcoded hex/gray/white), tests added for `summaryStrip.ts`.

The blocker is the **carry-forward C1+C2** from `po-receiving.service.ts` which must be fixed before the entire b0–b5 stack can be merged.

---

## Recommendation

**BLOCK** — do not merge the b0–b5 stack until C1 and C2 are fixed.

B5 itself would be APPROVE-with-warnings if it were a standalone branch. The two critical carry-forwards are one-line fixes each, both in the same file (`po-receiving.service.ts`). Fixing them in a b6 patch commit and rebasing or cherry-picking would unblock the entire series.

**Minimal fix (add as b6 or patch commit on b5):**
```ts
// po-receiving.service.ts — runReceiveInTx (line ~179)
- costPrice: Number(poItem.unitPrice),
+ costPrice: poItem.unitPrice,

// po-receiving.service.ts — directReceive (line ~313)
- const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
+ const totalAmount = dto.items.reduce(
+   (s, i) => s.plus(new Prisma.Decimal(i.unitPrice).times(i.quantity)),
+   new Prisma.Decimal(0),
+ );
```
