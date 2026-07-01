# Merge Guard Report — feat/purchasing-v2-b3

**Date**: 2026-07-01  
**Author**: iamnaii  
**Branch**: `feat/purchasing-v2-b3`  
**Commits**: 15 — DirectReceive endpoint, QcCenterPage, receiving service refactor

---

## File Changes Summary

| File | Changes | Type |
|------|---------|------|
| `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts` | +46 / 0 | New DTOs |
| `apps/api/src/modules/purchase-orders/purchase-orders.controller.ts` | +11 / -1 | New endpoint |
| `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` | +4 / 0 | Delegation |
| `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` | ~+130 / -200 | Major refactor |
| `apps/api/src/modules/purchase-orders/purchase-orders.direct-receive.spec.ts` | +117 / 0 | New tests |
| `apps/web/src/pages/QcCenterPage/index.tsx` | +290 / 0 | New page |
| `apps/web/src/pages/QcCenterPage/qcLabels.ts` | +34 / 0 | Config |
| `apps/web/src/pages/QcCenterPage/useQcCenter.ts` | +85 / 0 | New hook |
| `apps/web/src/pages/QcCenterPage/qcLabels.test.ts` | +45 / 0 | Tests |
| `apps/web/src/pages/PurchaseOrdersPage/...` | ~+750 / -125 | DirectReceive UI |
| **Total** | 21 files, 1,834 insertions, 566 deletions | Full-stack |

---

## Issues

### Critical
_None_

### Warning

**W1 — `Number()` on Prisma Decimal in `po-receiving.service.ts` (line ~190)**  
```ts
costPrice: Number(poItem.unitPrice),   // poItem comes from Prisma, unitPrice is Decimal
```
`poItem.unitPrice` is a `Prisma.Decimal` field (`@db.Decimal(12,2)`). Wrapping it in `Number()` converts it to a JavaScript float, which violates the project-wide rule "use Prisma.Decimal, never Number() on money fields" (v4 hardening removed 53 such occurrences across 12 services). The COGS value stored in `Product.costPrice` is used downstream in P&L and balance-sheet reports; a precision error here (e.g. 29999.999999...) could corrupt journal entries.

**Note**: This bug existed in the pre-refactor code (removed from line ~667) and was preserved when the receiving logic was extracted into the shared `runReceiveInTx` helper. The refactor moved the bug but did not fix it.

**Fix**:
```ts
// Option A — Decimal is already stored as Decimal; just pass it through
costPrice: poItem.unitPrice,

// Option B — if schema type mismatch requires explicit conversion
costPrice: new Prisma.Decimal(poItem.unitPrice.toString()),
```

---

**W2 — `Number()` arithmetic for financial total in `directReceive` (line ~324)**  
```ts
const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
```
`i.unitPrice` is a DTO field annotated `@IsNumber()` (already JS `number`), but `totalAmount` is stored in `purchaseOrder.totalAmount` which is `Decimal(12,2)` in the schema. Using float arithmetic to compute a running sum and then writing it to a Decimal column can introduce sub-cent rounding errors for large orders (e.g. 100 × 1234.56 in float ≠ exact Decimal sum).

**Fix**:
```ts
import { Prisma } from '@prisma/client';
const totalAmount = dto.items.reduce(
  (s, i) => s.add(new Prisma.Decimal(i.unitPrice).mul(i.quantity)),
  new Prisma.Decimal(0),
);
```

### Info

**I1 — Approval-bypass audit trail (PASS)**  
`directReceive` intentionally skips the standard PO approval flow (creates PO directly at `APPROVED → ORDERED`) and writes a `PO_DIRECT_RECEIVE_APPROVAL_BYPASS` AuditLog. This is correctly documented and tested. Roles are restricted to `OWNER` and `BRANCH_MANAGER`. No concern.

**I2 — `any` type in test file**  
`purchase-orders.direct-receive.spec.ts` uses `any` extensively for the Prisma mock (`const tx: any`). This is acceptable in test files per convention but is noted.

**I3 — `status: { in: ['QC_PENDING', 'PHOTO_PENDING'] }` should use enum values**  
In `po-query.service.ts` `getQCPending()` and `getSummary()`, product statuses are compared using raw strings `'QC_PENDING'` / `'PHOTO_PENDING'` rather than the Prisma-generated `ProductStatus` enum. If the enum value changes, the query silently returns nothing. Consider `status: { in: [ProductStatus.QC_PENDING, ProductStatus.PHOTO_PENDING] }`.

---

## Audit Trail

**Security**
- New `POST /purchase-orders/direct-receive` endpoint: class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` ✅
- Method-level `@Roles('OWNER', 'BRANCH_MANAGER')` ✅
- No raw `$queryRaw` / `$queryRawUnsafe` found ✅
- No secrets or API keys ✅

**Soft-delete**
- `runReceiveInTx`: `po.deletedAt` checked after fetch ✅
- `directReceive`: `supplier.findUnique` result checked for null (includes soft-delete logic inherited from service) ✅
- `getSummary`: uses `base = { deletedAt: null }` on every count ✅

**DTO validation**
- `DirectReceiveItemDto` has class-validator decorators on all fields ✅
- `DirectReceiveDto` has `@ArrayMinSize(1)` + `@ValidateNested` ✅
- Thai error messages present (`กรุณาระบุราคาทุน`) ✅

**Tests**
- 4 scenarios covering happy path, zero costPrice rejection, missing supplier, REJECT-unit persistence ✅

---

## Recommendation: ⚠️ REVIEW

**Block on W1** (Decimal precision on `costPrice` write). This is a financial data integrity issue — COGS values feed the journal and P&L. W2 should be fixed in the same pass since it's the same pattern. Both are 2-line fixes.

After W1+W2 are fixed, this branch is ready to merge.
