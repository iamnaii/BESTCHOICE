# Merge Guard Report — fix/fraud-audit-p1-controls

**Date**: 2026-04-19  
**Branch**: `fix/fraud-audit-p1-controls`  
**Author**: Akenarin Kongdach  
**Commit**: `09c8b4b2` — fix(fraud-audit): Phase 1 controls — POS discount cap, waive 4-eyes, LIFF dunning badge

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/api/src/modules/line-oa/liff-api.service.ts` | +20/-1 | dunningStage + daysOverdue in LIFF response |
| `apps/api/src/modules/payments/dto/payment.dto.ts` | +7 | Required `approverId` on WaiveLateFeeDto |
| `apps/api/src/modules/payments/payments.controller.ts` | +4/-4 | Expanded roles + approverId pass-through |
| `apps/api/src/modules/payments/payments.service.spec.ts` | +90/-1 | 5 new 4-eyes SoD tests |
| `apps/api/src/modules/payments/payments.service.ts` | +41/-10 | 4-eyes approver validation in waiveLateFee |
| `apps/api/src/modules/sales/dto/sale.dto.ts` | +7 | Optional `secondApproverId` field |
| `apps/api/src/modules/sales/sales.controller.ts` | +4/-4 | Passes user.role to service |
| `apps/api/src/modules/sales/sales.service.spec.ts` | +58 | 5 new discount-cap tests |
| `apps/api/src/modules/sales/sales.service.ts` | +86/-21 | assertDiscountAllowed() + costPrice lookup |
| `apps/web/src/pages/liff/LiffContract.tsx` | +50/-12 | Dunning badge + days-overdue display |

**Total**: 10 files changed, 351 insertions (+), 16 deletions (−)

---

## Issues Found

### Critical

**1. `Number()` on money field — `apps/api/src/modules/sales/sales.service.ts` ~line 187**

```typescript
// ❌ Critical — costPrice is Decimal @db.Decimal(12,2) in schema
if (product?.costPrice != null) {
  costPrice = Number(product.costPrice);
}
```

Then used for cost-floor arithmetic:
```typescript
const floor = costPrice * (1 - maxForRole);
if (netAfterDiscount < floor) { ... }
```

`product.costPrice` is a `Prisma.Decimal`. Converting via `Number()` introduces floating-point imprecision. Per project rules, **all money/financial fields must use `Prisma.Decimal` arithmetic**.

**Fix**: Use `Prisma.Decimal` throughout `assertDiscountAllowed`:
```typescript
// In create():
import { Prisma } from '@prisma/client';
let costPrice: Prisma.Decimal | null = null;
if (product?.costPrice != null) {
  costPrice = new Prisma.Decimal(product.costPrice.toString());
}

// In assertDiscountAllowed() signature: costPrice: Prisma.Decimal | null | undefined
// In the floor check:
const netAfterDiscount = new Prisma.Decimal(sellingPrice).minus(discount);
const floor = costPrice.mul(new Prisma.Decimal(1).minus(maxForRole));
if (netAfterDiscount.lessThan(floor)) { ... }
```

Note: `dto.sellingPrice` and `dto.discount` arrive as plain numbers from the DTO (typed `number`). Converting them to `Prisma.Decimal` at the boundary (inside the assertion method) is sufficient.

---

### Warning

**2. Shared type not updated — `packages/shared/src/liff-types.ts` missing `dunningStage`/`daysOverdue`**

`liff-api.service.ts` defines a local `LiffContractItem` interface that includes `dunningStage` and `daysOverdue`. The canonical shared type `LiffContract` in `packages/shared/src/liff-types.ts` does **not** have these fields. As a result, `LiffContract.tsx` works around this with three separate inline type assertions:

```tsx
(contract as Contract & { dunningStage?: string }).dunningStage
(contract as Contract & { daysOverdue?: number }).daysOverdue
```

This is fragile — any TS strict-null check on the shared type will silently miss the new fields. **Update `packages/shared/src/liff-types.ts`** to add `dunningStage?: string` and `daysOverdue?: number` to `LiffContract`, then remove the inline type assertions from `LiffContract.tsx`.

**3. TOCTOU window in `waiveLateFee` approver check**

The approver existence + role validation runs **before** the `$transaction`. If the approver is deactivated between the check and the transaction commit, the waiver proceeds with an invalidated approver. Risk is low (unlikely race), but for defence-in-depth consider moving the approver lookup inside the `$transaction` or repeating the `isActive` check at the write boundary.

---

### Info

**4. `sales.service.ts` — `assertDiscountAllowed` receives `sellingPrice`/`discount` as plain `number`**  
These come from the DTO (untyped from JSON). Consider a `@IsPositive()` check on `discount` in `CreateSaleDto` to reject negative discounts at the boundary (which could also defeat the cost-floor guard).

**5. `LiffContract.tsx` — IIFE inside JSX**  
The `{(() => { ... })()}` pattern for the dunning badge is functional but uncommon. A small named helper function or ternary would improve readability. Not blocking.

---

## Detailed Findings

### 4-Eyes Waiver (Payments)
Logic is correct:
- Empty `approverId` → `BadRequestException` ✓
- Self-approval → `ForbiddenException` ✓
- Missing/deactivated approver → `NotFoundException` ✓
- Non-manager-tier approver → `ForbiddenException` ✓
- `approverId` written to the audit trail ✓
- `@Roles` expansion to ACCOUNTANT matches the new SoD model ✓

### Discount Cap (Sales)
Role caps:
```
SALES          5%   (hard cap)
BRANCH_MANAGER 15%  (>10% needs secondApproverId)
FINANCE_MANAGER 25% (>10% needs secondApproverId)
ACCOUNTANT     5%
OWNER          unlimited
```
Cost-floor guard: `netAfterDiscount ≥ costPrice × (1 − maxForRole)` — logic is sound, but uses `Number()` on Decimal (see Critical #1).

### LIFF Dunning Badge
`dunningStage` already exists on `Contract` in main schema (`DunningStage @default(NONE)`). No migration needed. ✓  
`daysOverdue` computed server-side from oldest unpaid payment — prevents client-side skew. ✓  
Badge text uses professional tone (no threatening language). ✓  
Screen-reader-accessible plain text fallback for color-blind users. ✓

---

## Recommendation

**BLOCK**

One Critical issue must be resolved before merge: `Number()` used on a `Prisma.Decimal` money field in `sales.service.ts`. The fix is straightforward (see above). After fixing, also address Warning #2 (shared type update) before merge as it creates a silent type-safety gap in the LIFF frontend.
