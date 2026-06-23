# Pre-Merge Guard Report — SHOP JE Wiring Stack
**Date**: 2026-06-23  
**Reviewed by**: Pre-Merge Guard agent  
**Branches** (stacked, oldest→newest):
1. `feat/shop-je-wiring` (18 commits, 26 files, +2130/-22)
2. `feat/shop-trade-in` (27 commits, 40 files, +3466/-36)
3. `feat/shop-expense` (30 commits, 44 files, +3952/-36) ← tip — includes all above

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last updated**: 2026-06-23 15:59 +0700

---

## Purpose

Wires the previously-scaffolded SHOP-side JE templates to production callers across four phases:
- **P0/P1** (`shop-je-wiring`): `ShopDownPayment` at contract creation, `ShopInventoryTransfer` at activation, `ShopFinanceReceipt` via new `POST /shop/finance-settlements` endpoint
- **P2** (`shop-trade-in`): `ShopCashSale` per product at cash sale (cost-allocated, bundle-aware)
- **P3** (`shop-trade-in`): `ShopTradeIn` JE on BUYBACK accept
- **P4** (`shop-expense`): `ShopExpense` for `REPAIR_SERVICE` expense docs (routes to SHOP chart instead of FINANCE)

---

## File Changes Summary

### New modules
| File | Lines |
|------|-------|
| `modules/shop-finance-settlement/shop-finance-settlement.controller.ts` | 27 |
| `modules/shop-finance-settlement/shop-finance-settlement.service.ts` | 56 |
| `modules/shop-finance-settlement/dto/finance-settlement.dto.ts` | 17 |
| `modules/journal/shop-account-resolver.service.ts` | 85 |
| `modules/sales/shop-cash-sale-allocation.util.ts` | 55 |

### Modified services
| File | Total Lines | Added |
|------|-------------|-------|
| `contracts/contract-workflow.service.ts` | 694 ⚠️ | +64 |
| `contracts/services/contract-lifecycle.service.ts` | 716 ⚠️ | +88 |
| `sales/services/sale-writer.service.ts` | 473 | +50 |
| `trade-in/services/trade-in-lifecycle.service.ts` | ~350 | +28 |
| `expense-documents/services/expense-document-lifecycle.service.ts` | ~400 | +50 |

---

## Issues by Severity

### ✅ Critical — None

- `ShopFinanceSettlementController` correctly applies `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on every method.
- All financial arithmetic uses `new Decimal(x.toString())` consistently — no `Number()`, `parseFloat()`, or `parseInt()` on monetary values.
- No raw `$queryRaw` with string interpolation.
- No hardcoded secrets or API keys.
- No SQL injection vectors.

---

### ⚠️ Warning — 3 issues

#### W1 — `sale-writer.service.ts`: Missing `deletedAt: null` on `product.findMany` (SHOP cash-sale path)

**File**: `apps/api/src/modules/sales/services/sale-writer.service.ts`  
**Pattern violated**: Every Prisma query must include `where: { deletedAt: null }` (database.md rule)

```ts
// New code added in shop-trade-in branch — missing filter:
const prods = await tx.product.findMany({
  where: { id: { in: productIds } },   // ← deletedAt: null missing
  select: { id: true, category: true, costPrice: true },
});
```

The existing bundle-product query earlier in the same function correctly includes `deletedAt: null`. A soft-deleted product could theoretically be picked up here and have a SHOP JE posted against it.

**Fix**: Add `deletedAt: null` to the where clause:
```ts
where: { id: { in: productIds }, deletedAt: null },
```

---

#### W2 — `shop-account-resolver.service.ts`: Missing `deletedAt: null` on `branch.findUnique`

**File**: `apps/api/src/modules/journal/shop-account-resolver.service.ts`  
**Method**: `resolveBranchCashAccount()`

```ts
const branch = await client.branch.findUnique({
  where: { id: branchId },   // ← deletedAt: null missing
  select: { shopCashAccountCode: true },
});
```

A soft-deleted branch would return its cash account code rather than throwing, allowing SHOP JEs to post against a deleted branch's account. The service already throws on missing `shopCashAccountCode`, but does not guard against deleted branches.

**Fix**: 
```ts
const branch = await client.branch.findUnique({
  where: { id: branchId, deletedAt: null },
  select: { shopCashAccountCode: true },
});
```

---

#### W3 — `SettleFinanceDto`: Weak input validation

**File**: `apps/api/src/modules/shop-finance-settlement/dto/finance-settlement.dto.ts`

Three validation gaps:
1. `contractIds` uses `@IsString({ each: true })` — should use `@IsUUID('4', { each: true, message: 'รหัสสัญญาต้องเป็น UUID' })` to reject malformed IDs before they reach the DB query
2. `bankAccountCode` has no format validation — accepts any string (e.g. `"'; DROP TABLE ..."` is blocked by Prisma parameterization, but passing a non-existent account code will cause a JE validation failure rather than a clear DTO error)
3. `postedAt` uses `@IsString()` — should use `@IsISO8601({}, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })` (matches pattern from `pdf-report-query.dto.ts`)
4. Thai validation messages missing on `bankAccountCode` and `postedAt`

---

### ℹ️ Info — 2 observations

#### I1 — Large files: `contract-workflow.service.ts` (694 lines) and `contract-lifecycle.service.ts` (716 lines)

Both files were already large before this branch; the additions (+64 / +88 lines respectively) push them further over the 500-line guideline. This is not a new problem introduced by this branch, but both files are candidates for future extraction (e.g., the activation flow in `contract-workflow.service.ts` could move to a dedicated `shop-activation.service.ts`).

No action required before merge — tracking issue only.

#### I2 — `as any` on Prisma JSON path queries in production service files

```ts
{ metadata: { path: ['flow'], equals: 'shop-down-payment' } as any }
```

This pattern appears in `contract-workflow.service.ts` and `contract-lifecycle.service.ts`. It is an accepted workaround for Prisma's typed JSON filtering limitation and matches the identical pattern already present in existing production code throughout the codebase. Not a new issue.

---

## Test Coverage

New tests added across the stack:
| Test file | Added tests |
|-----------|-------------|
| `contract-workflow.service.spec.ts` | +150 lines |
| `contract-lifecycle.service.spec.ts` | +307 lines |
| `sale-writer.service.spec.ts` | +305 lines |
| `trade-in-lifecycle.service.spec.ts` | +178 lines |
| `expense-document-lifecycle-posting.service.spec.ts` | +263 lines |
| `shop-account-resolver.service.spec.ts` | +66 lines |
| `shop-cash-sale-allocation.util.spec.ts` | +50 lines |
| `shop-finance-settlement.service.spec.ts` | +60 lines |

Coverage is comprehensive. All new services have corresponding spec files.

---

## Recommendation

```
RECOMMENDATION: REVIEW
```

**Merge is NOT blocked** — no Critical issues found. The 3 Warning issues are minor convention violations that should be fixed before merge:

1. **W1** (5 min fix): Add `deletedAt: null` to `product.findMany` in `sale-writer.service.ts`
2. **W2** (2 min fix): Add `deletedAt: null` to `branch.findUnique` in `shop-account-resolver.service.ts`  
3. **W3** (5 min fix): Strengthen `SettleFinanceDto` — `@IsUUID` for contractIds, `@IsISO8601` for postedAt, format hint for bankAccountCode

All fixes are small and localized. After addressing W1-W3, this stack is ready to merge.
