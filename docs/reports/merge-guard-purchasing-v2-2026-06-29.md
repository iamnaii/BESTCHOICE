# Pre-Merge Guard Report — feat/purchasing-v2 series

**Date**: 2026-06-29  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: feat/purchasing-v2-b3, feat/purchasing-v2-b4, feat/purchasing-v2-b5  
**Author**: iamnaii <akenarin.ak@gmail.com>

---

## Branch Series Overview

These are stacked PRs building the Purchasing V2 feature. Each branch is incremental:

| Branch | Incremental diff | Description |
|--------|-----------------|-------------|
| `feat/purchasing-v2-b3` | 15 files, +1834 / -566 | Supplier-direct receive (auto-PO) + mobile receiving drawer |
| `feat/purchasing-v2-b4` | 21 files, +752 / -125 | QC center page at `/purchase-orders/qc` + `POST /qc-reject` |
| `feat/purchasing-v2-b5` | 7 files, +357 / -15 | Purchasing summary strip + overdue-only filter + AP tab polish |

---

## Branch: feat/purchasing-v2-b3

### Summary
Adds supplier-direct receive flow: `POST /purchase-orders/direct-receive` creates an auto-PO (bypassing approval gate — audited), runs the full `goodsReceiving` pipeline inside one Serializable transaction. Also adds mobile-first receiving drawer with IMEI duplicate detection.

### ✅ Security Check
- `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level ✅
- `@Roles('OWNER', 'BRANCH_MANAGER')` on new endpoint ✅
- `DirectReceiveDto` uses class-validator decorators ✅
- `deletedAt: null` in queries ✅
- Approval-bypass written to `AuditLog` with action `PO_DIRECT_RECEIVE_APPROVAL_BYPASS` ✅
- No hardcoded secrets ✅

### ❌ Critical Issues

#### C1 — `Number()` on Prisma.Decimal for `costPrice`
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:179`

```ts
// BEFORE (wrong)
costPrice: Number(poItem.unitPrice),
```

`poItem.unitPrice` is a `Prisma.Decimal` read from the DB (`@db.Decimal(12, 2)`). Converting it with `Number()` before writing it to `Product.costPrice` (also `@db.Decimal(12, 2)`) passes a JS float to Prisma. For values like `12,999.99` this is safe in practice, but this is the exact pattern the v4 hardening sprint fixed in 53 places — and the rule is explicit in `.claude/rules/accounting.md`.

**Fix**: Remove the `Number()` wrapper — `poItem.unitPrice` is already a `Decimal` and Prisma accepts it directly.

```ts
// AFTER (correct)
costPrice: poItem.unitPrice,
```

#### C2 — Floating-point arithmetic for `totalAmount`
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:313`

```ts
// BEFORE (wrong)
const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
```

`totalAmount` is passed to `tx.purchaseOrder.create()` where it writes to a `Decimal @db.Decimal(12, 2)` field. Floating-point accumulation can produce incorrect values (e.g. `30000.00 * 2 = 59999.999...`). The DTO `unitPrice` is a JS `number` from class-validator, so it must be wrapped in `Prisma.Decimal` before arithmetic.

**Fix**:

```ts
import { Prisma } from '@prisma/client';

const totalAmount = dto.items.reduce(
  (s, i) => s.plus(new Prisma.Decimal(i.unitPrice).times(i.quantity)),
  new Prisma.Decimal(0),
);
```

### ⚠️ Warning Issues

None beyond the Critical items above.

### ℹ️ Info
- Tests in `purchase-orders.direct-receive.spec.ts` cover the happy path, zero-cost guard, missing supplier, and defect-reason persistence — good coverage.
- IMEI duplicate detection (both in-batch and in-system) is well-implemented.
- T5-C16 ceiling re-read inside Serializable tx is correct.

### Recommendation: **REVIEW** — Fix C1 and C2 before merge.

---

## Branch: feat/purchasing-v2-b4

### Summary
Adds `GET /purchase-orders/qc` route + `QcCenterPage` with bulk confirm/reject. Adds `POST /purchase-orders/qc-reject` (soft-delete QC-failed units). Widens `getQCPending` to optionally include `PHOTO_PENDING` items and filter by `poId`.

### ✅ Security Check
- Inherits class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` ✅
- `@Roles('OWNER', 'BRANCH_MANAGER')` on both new endpoints ✅
- `RejectQCDto` — `@IsArray()`, `@ArrayNotEmpty()`, `@IsString()`, `@IsNotEmpty()` ✅
- `deletedAt: null` in `rejectQC` `findMany` ✅
- Frontend uses `api.post()`, `useMutation`, `invalidateQueries` — all correct ✅
- Route protected with `ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}` ✅

### ⚠️ Warning Issues

#### W1 — Missing `deletedAt: null` in `updateMany` (TOCTOU)
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` — `rejectQC()`

```ts
// The findMany validates deletedAt: null — good
const products = await tx.product.findMany({
  where: { id: { in: productIds }, deletedAt: null },  // ✅
});

// But the subsequent updateMany does not re-filter by deletedAt
await tx.product.updateMany({
  where: { id: { in: productIds } },  // ⚠️ no deletedAt: null
  data: { deletedAt: new Date() },
});
```

Inside a single `$transaction` with no isolation level set (defaults to `ReadCommitted`), a concurrent request could soft-delete one of the same products between the `findMany` and `updateMany`. While the practical risk is low (rare race + products would just get `deletedAt` updated twice), the database rule in `.claude/rules/database.md` is explicit: "ทุก query ต้องมี `where: { deletedAt: null }`".

**Fix**: Add `deletedAt: null` to the `updateMany` WHERE clause.

#### W2 — Missing entity-level AuditLog in `rejectQC`
**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` — `rejectQC()`

The global `AuditInterceptor` will log the HTTP POST, but it does not capture the specific `productId` array or the rejection `reason` as structured data. `rejectQC` permanently soft-deletes inventory units — a destructive, irreversible operation that warrants per-product audit trail (matching the pattern used by `confirmQC` events and repossession flows).

**Fix**: Add inside the transaction:

```ts
await Promise.all(
  products.map((p) =>
    tx.auditLog.create({
      data: {
        action: 'QC_REJECTED',
        entity: 'product',
        entityId: p.id,
        userId,
        newValue: { deletedAt: new Date().toISOString(), reason },
      },
    }),
  ),
);
```

Note: `userId` would need to be threaded through from the controller (currently not passed).

### ℹ️ Info
- `useQcCenter` hook — `invalidate()` clears `qc-center`, `qc-pending-count`, and `purchase-orders` in one place ✅
- Tests cover `QC_PENDING`/`PHOTO_PENDING` filter flags, `poId` filter, and invalid-status guard ✅
- `useQcPendingCount` polled every 30s via `refetchInterval` is appropriate ✅

### Recommendation: **REVIEW** — W2 (missing audit log) is important for a destructive inventory operation. W1 is a minor rules compliance issue.

---

## Branch: feat/purchasing-v2-b5

### Summary
Adds `PurchasingSummaryStrip` (7 KPI cards) wired to `GET /purchase-orders/summary`. Adds `overdueOnly` filter to the PO list. Polishes the AP tab with paid-progress bar and due-soon hints.

### ✅ Security Check
- No new API endpoints or backend changes.
- No hardcoded secrets ✅
- Design tokens used (`bg-warning`, `bg-success`, `text-destructive`) — all valid ✅
- Summary uses `api.get()` through `useQuery` ✅
- `queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] })` added to all 5 mutations ✅

### ⚠️ Warning Issues

#### W3 — Silent error swallow in AP tab row clicks
**File**: `apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx:73, 81`

```tsx
// Row onClick
onClick={async () => { try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {} }}

// Button onClick
onClick={async (e) => { e.stopPropagation(); try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {} }}
```

Both handlers swallow errors silently. If the API is unavailable, rate-limits, or the user loses connectivity, the click produces no visible feedback. The project standard (`frontend.md`) uses `toast.error(getErrorMessage(err))` for error feedback.

**Fix**:

```tsx
} catch (err) { toast.error(getErrorMessage(err)); }
```

### ℹ️ Info
- `PurchasingSummaryStrip` — accessible `aria-label` on each card button ✅
- `summaryStrip.test.ts` — 61-line test suite covering filter-action mapping ✅
- Summary strip returns `null` when data is unavailable (graceful degradation) ✅
- `overdueOnly` state lifted into `usePurchaseOrdersData` hook and propagated through `POListTabProps` ✅

### Recommendation: **APPROVE** — W3 is a UX polish issue with no security or data integrity risk. Can be fixed in a follow-up or alongside.

---

## Summary Table

| Branch | Files Changed | Critical | Warning | Info | Recommendation |
|--------|--------------|----------|---------|------|----------------|
| feat/purchasing-v2-b3 | +15 files | 2 (Decimal precision) | 0 | 3 | **REVIEW** |
| feat/purchasing-v2-b4 | +21 files | 0 | 2 (audit + TOCTOU) | 3 | **REVIEW** |
| feat/purchasing-v2-b5 | +7 files | 0 | 1 (silent catch) | 4 | **APPROVE** |

## Required Fixes Before Merge

1. **[B3-C1]** `po-receiving.service.ts:179` — Replace `Number(poItem.unitPrice)` with `poItem.unitPrice`
2. **[B3-C2]** `po-receiving.service.ts:313` — Replace float reduce with `Prisma.Decimal` arithmetic
3. **[B4-W2]** `rejectQC()` — Add `auditLog.create()` per rejected product (thread `userId` from controller)
4. **[B4-W1]** `rejectQC()` updateMany — Add `deletedAt: null` to WHERE clause
