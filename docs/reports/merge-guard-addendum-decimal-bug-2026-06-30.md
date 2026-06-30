# ADDENDUM: Critical Decimal Bugs Merged to Main — 2026-06-30

**⚠️ CRITICAL — These bugs are LIVE on `origin/main` and affect financial data**

The prior guard report (same file, same date) correctly flagged `feat/purchasing-v2-b3` as **BLOCK** due to two Critical Decimal issues. The branch was cherry-picked to main regardless. This addendum confirms both issues are live and documents the exact lines to fix.

---

## Confirmed Live Bugs on `origin/main`

### Bug 1 — `costPrice: Number(poItem.unitPrice)` truncates Decimal precision

**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:179`

```ts
// BUG — current code on main:
const product = await tx.product.create({
  data: {
    costPrice: Number(poItem.unitPrice),   // ← Float coercion of Prisma.Decimal
    ...
  },
});
```

`poItem.unitPrice` is a `Prisma.Decimal` fetched from the DB. `Number()` converts it to a 64-bit IEEE 754 float before writing to `Product.costPrice` (`@db.Decimal(12,2)`). For prices with fractional cents (e.g., 12345.675) this can silently corrupt the cost recorded in inventory.

**Fix**:
```ts
costPrice: new Prisma.Decimal(poItem.unitPrice),
// or simply:
costPrice: poItem.unitPrice,  // Prisma accepts Prisma.Decimal directly
```

---

### Bug 2 — Float accumulation for PO `totalAmount` / `netAmount`

**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:313`

```ts
// BUG — current code on main:
const totalAmount = dto.items.reduce(
  (s, i) => s + Number(i.unitPrice) * i.quantity,
  0,
);
const po = await tx.purchaseOrder.create({
  data: {
    totalAmount,    // stores float accumulation into Decimal(12,2) column
    netAmount: totalAmount,
    ...
  },
});
```

JavaScript float arithmetic: `12345.67 × 3` can yield `37037.009999999995` instead of `37037.01`. Postgres rounds silently at the Decimal boundary, masking the error — but the value stored may differ from what the DTO summed.

**Fix**:
```ts
import { Prisma } from '@prisma/client';

const totalAmount = dto.items.reduce(
  (sum, i) => sum.plus(new Prisma.Decimal(i.unitPrice).times(i.quantity)),
  new Prisma.Decimal(0),
);
// totalAmount is Prisma.Decimal — pass directly to create()
```

---

## Impact Assessment

| Aspect | Risk |
|--------|------|
| **Affected flow** | `POST /purchase-orders/direct-receive` (auto-PO creation from supplier) |
| **Affected fields** | `Product.costPrice`, `PurchaseOrder.totalAmount`, `PurchaseOrder.netAmount` |
| **Frequency** | Every direct-receive operation |
| **Data corruption risk** | Low-probability for round amounts (e.g., 15,000 THB); higher for prices with decimal cents |
| **Accounting impact** | COGS (`S50-XXXX`) will be computed from `Product.costPrice` — an incorrect cost propagates to SHOP P&L |
| **Detectability** | Silent — no error thrown; mismatch only visible in audit reconciliation |

---

## Recommended Fix Priority: P0 (before next direct-receive operation in production)

The fix is mechanical — replace `Number()` with `Prisma.Decimal`. Estimated effort: < 30 minutes including test.

File to edit: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts`  
Lines: 179 and 313  

After fix, run:
```bash
./tools/check-types.sh api
cd apps/api && npx jest purchase-orders.direct-receive
```
