# Merge Guard Report — feat/purchasing-v2-b2 + b3 + b4

**Date**: 2026-06-29  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: `feat/purchasing-v2-b2` (7 commits), `feat/purchasing-v2-b3` (4 commits), `feat/purchasing-v2-b4` (3 commits)  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Last commit**: 2026-06-29 17:58 +07  
**Prior guard review**: `docs/reports/merge-guard-feat-purchasing-v2-2026-06-29.md` (covers b0+b1)

---

## Branch Overview

This report covers the continuation of **Purchasing v2** across three stacked branches, building on b0+b1 which were reviewed earlier today.

| Branch | Commits | Changed files (vs main) | Focus |
|--------|---------|------------------------|-------|
| `feat/purchasing-v2-b2` | 7 | 47 | CreatePO 4-step wizard, mobile receiving drawer, direct-receive mutation, ReceivingUnitCard |
| `feat/purchasing-v2-b3` | 4 | 54 | Backend: `POST /direct-receive`, `POST /qc-reject`, widened `getQCPending` filters |
| `feat/purchasing-v2-b4` | 3 | 67 | QC Center page (`/purchase-orders/qc`), nav badge, retire inline QcPendingPanel |

**Merge order**: b0 → b1 → b2 → b3 → b4 (stacked; each requires prior branch).

**Note**: The C1 bug flagged in the b0+b1 report (`costPrice: Number(poItem.unitPrice)` in `goodsReceiving()`) has **not been fixed** in b2/b3/b4 and remains present.

---

## File Change Summary (b2/b3/b4 incremental, vs b1)

### Backend (b3)
- `purchase-orders.controller.ts` — adds `POST /qc-reject`, `POST /direct-receive`, `GET /summary`, widened `GET /qc-pending` query params
- `purchase-orders.service.ts` — delegates to `receiving.directReceive()`, `receiving.rejectQC()`, `receiving.getSummary()`
- `services/po-receiving.service.ts` — refactors `goodsReceiving()` into shared `runReceiveInTx()`, adds `directReceive()`, adds `rejectQC()`
- `services/po-query.service.ts` — adds `getSummary()`, widens `getQCPending` with `poId` + `includePhotoPending` params
- `dto/create-po.dto.ts` — adds `DirectReceiveDto`, `DirectReceiveItemDto`, `RejectQCDto`, `OrderPODto`
- 3 new spec files: `purchase-orders.direct-receive.spec.ts`, `purchase-orders.qc-pending.spec.ts`, `purchase-orders.qc-reject.spec.ts`

### Frontend (b2 + b4)
- `PurchaseOrdersPage/components/CreatePOModal.tsx` — 4-step wizard shell (287 lines)
- `PurchaseOrdersPage/components/wizard/` — 4 step components: `StepSupplier`, `StepItems`, `StepDiscountVat`, `StepReview`
- `PurchaseOrdersPage/components/DirectReceiveModal.tsx` — supplier-direct receive entry UI
- `PurchaseOrdersPage/components/GoodsReceivingModal.tsx` — mobile drawer + camera + IMEI dup feedback
- `PurchaseOrdersPage/components/ReceivingUnitCard.tsx` — per-unit receive card
- `PurchaseOrdersPage/hooks/useCreatePoWizard.ts` — wizard state machine
- `PurchaseOrdersPage/poTotals.ts` — frontend PO money breakdown (display only)
- `QcCenterPage/index.tsx` — new QC center page (290 lines)
- `QcCenterPage/useQcCenter.ts` — QC center data hook
- `hooks/useQcPendingCount.ts` — nav badge count hook
- `App.tsx` — lazy routes for `QcCenterPage` + `GoodsReceiptPrintPage` under `ProtectedRoute`

---

## Issues Found

### 🔴 CRITICAL

#### C1 — `totalAmount` / `netAmount` computed with float arithmetic for Decimal DB fields
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` (new `directReceive` function)  
**Code**:
```ts
const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
const po = await tx.purchaseOrder.create({
  data: {
    ...
    totalAmount,
    netAmount: totalAmount,  // stored as Decimal(12,2)
  }
});
```
**Why critical**: `PurchaseOrder.totalAmount` and `PurchaseOrder.netAmount` are `Decimal @db.Decimal(12, 2)`. This code computes them using plain JavaScript float arithmetic. While Prisma will coerce the JS number on write, floating-point errors accumulate when summing multiple line items (e.g. `1999.99 * 3` = `5999.970000000001` in IEEE 754). This violates the database rule ("ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน") and the v4 hardening pattern ("53 `Number()` → `Prisma.Decimal` ใน 12 services").

**Fix**:
```ts
import { Prisma } from '@prisma/client';
const totalAmount = dto.items.reduce(
  (s, i) => s.add(new Prisma.Decimal(i.unitPrice).mul(i.quantity)),
  new Prisma.Decimal(0),
);
// totalAmount is now Prisma.Decimal — pass directly to purchaseOrder.create
```

#### C2 — Prior unfixed: `costPrice: Number(poItem.unitPrice)` in `runReceiveInTx` (carry-forward from b0 report)
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts`  
**Status**: Flagged in b0+b1 report as C1; still unfixed in b2/b3/b4. The refactor moved the code from the old `goodsReceiving()` body into the shared `runReceiveInTx()` helper, but the `Number()` cast was preserved.  
**Impact**: `Product.costPrice` is `Decimal @db.Decimal(12, 2)` — same precision risk as C1 above.  
**Fix**: `costPrice: poItem.unitPrice` (Prisma.Decimal passes through directly without wrapping).

---

### 🟡 WARNING

#### W1 — `poTotals.ts` uses JavaScript float arithmetic for display calculations
**File**: `apps/web/src/pages/PurchaseOrdersPage/poTotals.ts:29-45`  
**Code**:
```ts
const subtotal = items.reduce(
  (sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0),
  0,
);
const vatAmount = supplierHasVat ? round2(subtotalAfterDiscount * VAT_RATE) : 0;
```
**Severity**: Warning (not Critical) because this is **frontend display-only** — the final stored values come from the backend `create()` which has its own Decimal arithmetic. The comment in the file acknowledges this and notes it mirrors the backend's rounding behavior.  
**Risk**: The wizard's displayed totals (pre-submit) may show a 1-satang rounding diff vs. what the backend actually stores. Could confuse users at submit time if displayed total ≠ stored total. Consider extracting a shared Decimal utility or using `toFixed(2)` consistently.

#### W2 — `getQCPending` uses `Record<string, unknown>` for the Prisma `where` clause
**File**: `apps/api/src/modules/purchase-orders/services/po-query.service.ts:323`  
**Code**:
```ts
const where: Record<string, unknown> = { deletedAt: null, status: ... };
if (filters.poId) where.poId = filters.poId;
```
**Risk**: Loses Prisma type safety. If the `Product` model changes (field renamed, removed), this query won't catch it at compile time. Prefer a typed `Prisma.ProductWhereInput` to get TypeScript validation.

---

### ℹ️ INFO

#### I1 — `rejectQC` does a hard-cascade soft-delete with no audit log entry
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts`  
**Code**: `await tx.product.updateMany({ where: {...}, data: { deletedAt: new Date() } })`  
**Note**: QC rejection removes products from inventory permanently (soft-delete = effectively gone). For financial audit purposes (reconciling received-but-rejected goods against supplier invoice), an `AuditLog` entry with `action: 'QC_REJECTED'` would aid traceability. The `PO_DIRECT_RECEIVE_APPROVAL_BYPASS` audit in `directReceive` is a good pattern to follow here.

#### I2 — New `QcCenterPage` and `GoodsReceiptPrintPage` routes protected correctly
**File**: `apps/web/src/App.tsx`  
Both routes use `<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>` — consistent with the `@Roles('OWNER', 'BRANCH_MANAGER')` on the API endpoints. ✅ No issue, confirming alignment.

#### I3 — `useQcPendingCount` polling interval
**File**: `apps/web/src/hooks/useQcPendingCount.ts`  
The hook polls `GET /purchase-orders/summary` to drive the nav badge. Confirm the `refetchInterval` is set to a reasonable value (e.g. 60s) and not something aggressive like 5s that could add noise to API metrics.

---

## Guards & Security Check

| Check | Result |
|-------|--------|
| New controller has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level | ✅ Pre-existing, unchanged |
| All new endpoints have `@Roles(...)` | ✅ `getSummary`, `getQCPending`, `rejectQC`, `directReceive`, `order` all decorated |
| No new public endpoints missing from allowlist | ✅ None |
| No raw `$queryRaw` with unparameterized input | ✅ None found |
| No hardcoded secrets or API keys | ✅ None found |
| Frontend uses `api.get()`/`api.post()` (not raw fetch) | ✅ All new mutations use `api.*` |
| `queryClient.invalidateQueries()` after all mutations | ✅ `purchase-orders`, `qc-center`, `qc-pending-count` all invalidated |
| New queries include `deletedAt: null` | ✅ `getSummary`, `getQCPending`, `rejectQC` all filter correctly |
| Soft-delete used (not hard delete) | ✅ `rejectQC` uses `deletedAt: new Date()` |

---

## Recommendation

**BLOCK** — do not merge until C1 and C2 are fixed.

Both critical issues are in the same file (`po-receiving.service.ts`) and are one-line fixes each. The rest of the branch (QC center, wizard, mobile UI, route wiring) is clean.

**Suggested fix sequence:**
1. In `runReceiveInTx`: change `costPrice: Number(poItem.unitPrice)` → `costPrice: poItem.unitPrice`
2. In `directReceive`: replace JS reduce with `Prisma.Decimal` arithmetic for `totalAmount`
3. Re-run `./tools/check-types.sh all` to confirm zero TS errors
4. Re-run `purchase-orders.direct-receive.spec.ts` to confirm the fix doesn't break tests

Once both fixes land (can be in a tiny b3-fix commit), this stack is ready to merge in order: b0 → b1 → b2 → b3 → b4.
