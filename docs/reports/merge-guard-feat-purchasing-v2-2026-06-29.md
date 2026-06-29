# Merge Guard Report — feat/purchasing-v2-b0 + feat/purchasing-v2-b1

**Date**: 2026-06-29  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: `feat/purchasing-v2-b0` (8 commits), `feat/purchasing-v2-b1` (14 commits)  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Last commit**: 2026-06-29 15:13 +07  

---

## Branch Overview

These two branches implement **Purchasing v2** — a major overhaul of the purchase order receiving flow.

| Branch | Commits | Changed files | Focus |
|--------|---------|---------------|-------|
| `feat/purchasing-v2-b0` | 8 | 24 | Backend: schema migration, DefectReason enum, grNumber generator, goodsReceiving() rewrite, retire legacy receive() |
| `feat/purchasing-v2-b1` | 14 | 37 | Frontend + API: ORDERED status, summary endpoint, print page, PO list/detail UX, tests |

**Merge order**: b0 must merge before b1 (b1 is stacked on b0).

---

## File Change Summary

### feat/purchasing-v2-b0 (backend)
- `prisma/migrations/20260978000000_purchasing_v2_foundation/migration.sql` — adds `ORDERED` to `POStatus` enum, `DefectReason` enum, `ordered_at`, `is_direct_receive` on `purchase_orders`, `defect_reason` on `goods_receiving_items`, `gr_number` (nullable→backfill→NOT NULL+UNIQUE) on `goods_receivings`
- `purchase-orders.controller.ts` — adds `POST /:id/order`, removes dead `POST /:id/receive`
- `purchase-orders.service.ts` — delegates new `order()`, removes `receive()`
- `services/po-lifecycle.service.ts` — implements `order(id, userId, dto)`
- `services/po-receiving.service.ts` — adds `generateGRNumber()`, wires into `goodsReceiving()` with P2002/P2034 retry
- `dto/create-po.dto.ts` — adds `OrderPODto`, `DefectReason` enum usage, removes dead `ReceivePODto`/`ReceiveItemDto`

### feat/purchasing-v2-b1 (frontend + tests)
- `App.tsx` — lazy route for `GoodsReceiptPrintPage` under `ProtectedRoute`
- `PurchaseOrdersPage/GoodsReceiptPrintPage.tsx` — printable ใบรับของ page (new, 250 lines)
- `PurchaseOrdersPage/components/PODetailModal.tsx` — status timeline, per-item QC progress, GR history
- `PurchaseOrdersPage/components/POListTab.tsx` — ORDERED pill, overdue badge, progress bar, สั่งซื้อ action
- `PurchaseOrdersPage/index.tsx` — wires `orderMutation`
- `PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` — adds `orderMutation` with `invalidateQueries`
- `PurchaseOrdersPage/po-list.util.ts` + `.test.ts` — `receiveProgress()`, `isOverdue()` helpers
- `PurchaseOrdersPage/po-detail.util.ts` + `.test.ts` — `timelineSteps()` helper
- 4 new API spec files: `purchase-orders.defect.spec.ts`, `.grnumber-retry.spec.ts`, `.order.spec.ts`, `.summary.spec.ts`

---

## Issues Found

### 🔴 CRITICAL

#### C1 — `Number()` on Decimal money field in `goodsReceiving()` path
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:156` (b0), same line in b1  
**Code**:
```ts
costPrice: Number(poItem.unitPrice),
```
**Why critical**: `POItem.unitPrice` is `Decimal @db.Decimal(12, 2)`. `Product.costPrice` is `Decimal @db.Decimal(12, 2)`. Wrapping with `Number()` converts a `Prisma.Decimal` to a JavaScript float — for values above ~15 digits this silently loses precision and Prisma will reject the assignment at runtime (type mismatch) or store a float-approximated value. This violates the project's database rule ("ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน") and the v4 hardening principle ("53 `Number()` → `Prisma.Decimal`").

**Note**: The *old* `receive()` path in `main` also had this bug (lines 86 and 250 of the pre-existing file). The b0 branch retired `receive()` and rewrote `goodsReceiving()`, but **copied the bug** into the new path (line 156). The old buggy lines no longer exist in b0/b1, so this is the only remaining instance — but it's in the *only* active code path and must be fixed before merge.

**Fix**:
```ts
import { d } from '../../../utils/decimal.util';
// ...
costPrice: d(poItem.unitPrice),  // Prisma.Decimal — never Number()
```

---

### 🟡 WARNING

#### W1 — `getGoodsReceivingById` missing `deletedAt: null` filter
**File**: `apps/api/src/modules/purchase-orders/services/po-query.service.ts` (b1)  
**Code**:
```ts
async getGoodsReceivingById(poId: string, receivingId: string) {
  const receiving = await this.prisma.goodsReceiving.findFirst({
    where: { id: receivingId, poId },  // ← missing deletedAt: null
    ...
  });
```
**Why warning**: `GoodsReceiving` has `deletedAt DateTime?` (confirmed in schema). A soft-deleted receiving record could be fetched and rendered on the print page (`/purchase-orders/:id/goods-receivings/:receivingId/print`). It won't be critical (no money writes, read-only), but violates the project rule "ทุก query ต้องมี `where: { deletedAt: null }` เสมอ".

**Fix**:
```ts
where: { id: receivingId, poId, deletedAt: null },
```

#### W2 — `OrderPODto` has no Thai validation messages
**File**: `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts` (b0)  
```ts
export class OrderPODto {
  @IsDateString()   // ← no { message: 'กรุณาระบุวันที่...' }
  @IsOptional()
  expectedDate?: string;
}
```
**Context**: The other DTOs in this file (`CreatePODto`, `RejectPODto`, etc.) also lack Thai messages — this is a pre-existing pattern in the purchasing module, not newly introduced. Flagged for consistency but low urgency.

---

### 🔵 INFO

#### I1 — `bg-white` in `GoodsReceiptPrintPage.tsx`
```tsx
className="voucher-sheet bg-white border border-border ..."
```
Frontend rules exempt `bg-white` in print/receipt contexts. This is correctly used on a printable voucher sheet. **Not a violation.**

#### I2 — Migration timestamp `20260978` month field > 12
The migration is timestamped `20260978000000` — the month digits `97` are out of range. This is likely a convention in this project (sequential number, not actual date), and migration ordering is by the full numeric prefix. **No action needed** if this is consistent with other migrations.

#### I3 — `GoodsReceiptPrintPage` line count
At 250 lines, this page is well within the 500-line threshold.

---

## What Looks Good ✓

- `PurchaseOrdersController` has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level — all new endpoints inherit it
- All new endpoint methods (`getSummary`, `order`, `getGoodsReceivingById`) have `@Roles()` decorators
- `GoodsReceiptPrintPage` route is wrapped in `ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}`
- `orderMutation` uses `api.post()` (not raw fetch) and calls `queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })` on success
- `useDebounce(search, 250)` correctly applied to PO list search
- `POListTab` uses `api.get()` via `useQuery` — no raw fetch
- `getSummary` properly uses `deletedAt: null` base filter on all `purchaseOrder.count()` calls
- `order()` lifecycle method correctly validates `status !== 'APPROVED'` before transition
- Migration uses safe 2-step for `gr_number` (nullable → backfill → NOT NULL + UNIQUE) — no data loss risk
- 4 new test files covering: defect reason persistence, grNumber P2002 retry, `order()` state machine, `getSummary()` counts
- `po-list.util.ts` and `po-detail.util.ts` each have co-located `.test.ts` files

---

## Recommendation

### feat/purchasing-v2-b0: **BLOCK**
Must fix **C1** (`Number(poItem.unitPrice)` → `d(poItem.unitPrice)` / `Prisma.Decimal`) before merge. Everything else is clean.

### feat/purchasing-v2-b1: **BLOCK** (dependent on b0)
Cannot merge until b0 is fixed and merged. After b0 merges, fix **W1** (`deletedAt: null` in `getGoodsReceivingById`) and this branch is clear to merge.

---

## Suggested Fix for C1 (1-line change)

In `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts`, find:
```ts
costPrice: Number(poItem.unitPrice),
```
Replace with (using the project's existing `d()` decimal utility):
```ts
costPrice: new Prisma.Decimal(poItem.unitPrice),
```
or via the existing `d()` helper imported from `decimal.util`:
```ts
costPrice: d(poItem.unitPrice),
```

This is the only remaining `Number()` on a money field in these two branches — the other instances were in the retired `receive()` function which has been deleted.
