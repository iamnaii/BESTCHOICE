# Merge Guard Report — feat/damage-resale-block

**Date**: 2026-04-20  
**Branch**: `feat/damage-resale-block`  
**Author**: Akenarin Kongdach  
**Commits**: 1 (`d049ffbf feat(sales/inventory): damage → resale fraud block (T5-C8)`)  
**Recommendation**: 🔴 BLOCK

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/src/modules/inventory/stock-adjustments.service.ts` | +31 | FOUND restoration gate — OWNER-only for DAMAGED/WRITTEN_OFF |
| `apps/api/src/modules/inventory/stock-adjustments.service.spec.ts` | +82 | Tests for T5-C8 restoration gates |
| `apps/api/src/modules/sales/sales.service.ts` | +66 | `wasPreviouslyDamaged` guard before sale; `verifyProductInStock` signature extension |
| `apps/api/src/modules/sales/sales.service.spec.ts` | +60 | Tests for T5-C8 sale guard |
| `apps/api/src/modules/sales/dto/sale.dto.ts` | +6 | `previouslyDamagedAcknowledged?: boolean` DTO field |

---

## Issues

### 🔴 Critical

#### C1 — `verifyProductInStock` callers never forward `opts` → happy path broken

**Files**: `apps/api/src/modules/sales/sales.service.ts` lines 411, 500, 651

The new `verifyProductInStock` signature adds an optional `opts?: { userRole?: string; acknowledged?: boolean }` and gates `wasPreviouslyDamaged` products with:

```typescript
if (product.wasPreviouslyDamaged) {
  if (!opts?.acknowledged) {   // ← undefined when opts not passed → always throws
    throw new BadRequestException('สินค้านี้เคยมีสถานะ DAMAGED ...');
  }
  ...
}
```

All three call sites pass only two arguments:
```typescript
await this.verifyProductInStock(tx, dto.productId);   // line 411 (cash)
await this.verifyProductInStock(tx, dto.productId);   // line 500 (installment)
await this.verifyProductInStock(tx, dto.productId);   // line 651 (external finance)
```

Because `opts` is `undefined`, `opts?.acknowledged` is falsy → `BadRequestException` fires inside every transaction for `wasPreviouslyDamaged` products, even when the outer pre-check (lines 253–280) already validated role + acknowledgement. **The T5-C8 happy path (OWNER + acknowledged) is completely broken in production.**

The code comment at line 253 says *"the downstream verifyProductInStock inside the tx just needs to re-confirm in-stock"*, indicating the guard duplication inside the transaction was not intended — but the implementation does not reflect this.

**Fix options (pick one):**
1. Forward opts at all three call sites:  
   `await this.verifyProductInStock(tx, dto.productId, { acknowledged: dto.previouslyDamagedAcknowledged, userRole });`
2. Guard the T5-C8 block in `verifyProductInStock` with `if (opts && product.wasPreviouslyDamaged)` so it only fires when opts is explicitly passed (and remove the duplicate outer pre-check).

---

### ⚠️ Warning

#### W1 — LOST adjustments set `wasPreviouslyDamaged=true`, triggering OWNER-only sale restriction

**File**: `apps/api/src/modules/inventory/stock-adjustments.service.ts` line ~120

```typescript
} else if (['DAMAGED', 'LOST', 'WRITE_OFF'].includes(dto.reason)) {
  data: { status: ..., deletedAt: new Date(), wasPreviouslyDamaged: true }
}
```

A phone that goes LOST (e.g., left at a branch and recovered the next day) permanently requires OWNER/FINANCE_MANAGER to sell. The restoration gate (C8) correctly allows BRANCH_MANAGER to approve LOST→FOUND, but the sticky `wasPreviouslyDamaged` flag applies the same sale restriction as DAMAGED→FOUND. This may be unintentional business-logic over-reach. Needs owner sign-off.

#### W2 — Double product query in `create()` for the same product

**File**: `apps/api/src/modules/sales/sales.service.ts` lines ~258–276 and ~280–288

Product is fetched twice sequentially:
1. `select: { wasPreviouslyDamaged, deletedAt }` for T5-C8 pre-check
2. `select: { costPrice, deletedAt }` for cost floor check

These can be merged into a single query: `select: { wasPreviouslyDamaged, deletedAt, costPrice }`.

---

### ℹ️ Info

- Good test coverage: 5 cases cover the FOUND restoration gate and the sale guard correctly
- Thai error messages present on all new exceptions ✓
- `ForbiddenException` / `BadRequestException` used appropriately ✓
- `restoredFromTerminalAt` and `wasPreviouslyDamaged` stamp pattern is clean for audit trail ✓
- No new controllers, no missing guards ✓

---

## Verdict

**🔴 BLOCK** — C1 is a broken happy path. OWNER + `previouslyDamagedAcknowledged: true` will always throw inside the transaction for all three sale types. Fix by forwarding `opts` at lines 411, 500, 651 or adjusting the guard condition in `verifyProductInStock`.
