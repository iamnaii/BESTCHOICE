# SHOP-side JE Wiring — P2 (ShopCashSale) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post SHOP cash-sale journal entries when a cash `Sale` is recorded, one JE per product (bundle-aware), so `/shop/accounting` reflects cash-sale revenue + COGS.

**Architecture:** At `SaleWriterService.createCashSale()` (replacing the `W-007` TODO), load the sale's products (main + bundle), allocate the net revenue across them **proportionally by `Product.costPrice`** (the `Sale` model has no per-product line price — confirmed default, spec §6B), then post `ShopCashSaleTemplate` per product **inside the existing `$transaction`**, resolving category→S-codes + cash account via the `ShopAccountResolver` built in P1.

**Tech Stack:** NestJS, Prisma (PostgreSQL), TypeScript, jest (`--runInBand`).

**Spec:** `docs/superpowers/specs/2026-06-23-shop-je-wiring-design.md` (§6 ShopCashSale + §6B bundles + §5 resolver).

**Depends on P0+P1** (`ShopAccountResolver`, X5 PEAK isolation) — in **PR #1280**. **Branch P2 off `feat/shop-je-wiring`** so the resolver + X5 are present; rebase onto `main` once #1280 merges. **Do not merge P2 before #1280** (X5 must be on `main` before any SHOP JE reaches prod).

## Global Constraints

- **Atomic:** `ShopCashSaleTemplate.execute(..., tx)` is called with the `createCashSale` `$transaction` `tx` (Serializable) so a JE failure rolls back the whole sale.
- **One JE per product**, idempotency key `shop-cash-sale:<saleId>:<productId>` (the template self-dedupes on `metadata.flow='shop-cash-sale'` + `idempotencyKey`).
- **Revenue base = `netAmount`** (after discount); cash + revenue both = the product's allocated share; allocated shares **sum exactly to `netAmount`** (last product absorbs the rounding residual).
- **Allocation:** proportional by `Product.costPrice`; if total cost = 0 (all give-aways), all revenue → the main (first) product. Each product's `inventoryCost` = its own `costPrice`. Skip a product whose allocated revenue is 0 (the template requires `revenueAmount > 0`; its COGS pair is optional when cost is 0).
- **Cash routing:** `paymentMethod === 'CASH'` → branch till (`resolveBranchCashAccount`); any other method → `S11-1201` (`SHOP_RECEIVING_BANK`).
- **Account codes** from `ShopAccountResolver.resolveProductAccounts(product.category)` (PHONE_NEW/TABLET→…2001/1101/1101, PHONE_USED→…2002/1102/1102, ACCESSORY→…2003/1103/1103).
- **Money:** `Decimal` only (`new Decimal(x.toString())`); never `Number()`. Rounding `toDecimalPlaces(2, Decimal.ROUND_HALF_UP)`.
- **Test runner:** `npm --prefix apps/api test -- <spec>` (run from repo root; jest `--runInBand`). Output pristine.
- **DI fan-out:** adding required ctor deps to `SaleWriterService` breaks every TestingModule that constructs it — update ALL and run the whole `src/modules/sales` suite (lesson from P1 Task 6/7).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/modules/sales/shop-cash-sale-allocation.util.ts` (create) | pure `allocateCashSaleByCost(netAmount, products)` → per-product `{revenue,cost}` | 1 |
| `apps/api/src/modules/sales/shop-cash-sale-allocation.util.spec.ts` (create) | allocation golden tests | 1 |
| `apps/api/src/modules/journal/shop-account-resolver.service.ts` (modify) | add `resolveInflowCashAccount(branchId, paymentMethod, tx?)` | 2 |
| `apps/api/src/modules/journal/shop-account-resolver.service.spec.ts` (modify) | routing tests | 2 |
| `apps/api/src/modules/sales/services/sale-writer.service.ts` (modify ~:111-147) | inject template+resolver; post ShopCashSale per product (replace TODO) | 3 |
| `apps/api/src/modules/sales/services/sale-writer.service.spec.ts` (create/modify) | wiring integration tests | 3 |
| `apps/api/src/modules/sales/sales.module.ts` (verify/modify) | ensure `JournalModule` imported (resolver+template injectable) | 3 |

---

## Task 1: `allocateCashSaleByCost` pure util

**Files:**
- Create: `apps/api/src/modules/sales/shop-cash-sale-allocation.util.ts`
- Test: `apps/api/src/modules/sales/shop-cash-sale-allocation.util.spec.ts`

**Interfaces:**
- Produces: `allocateCashSaleByCost(netAmount: Decimal, products: { id: string; costPrice: Decimal }[]): { productId: string; revenue: Decimal; cost: Decimal }[]`

- [ ] **Step 1: Write the failing tests** (`shop-cash-sale-allocation.util.spec.ts`):

```typescript
import { Decimal } from '@prisma/client/runtime/library';
import { allocateCashSaleByCost } from './shop-cash-sale-allocation.util';

const D = (v: string | number) => new Decimal(v);

describe('allocateCashSaleByCost', () => {
  it('single product → all revenue, its own cost', () => {
    const res = allocateCashSaleByCost(D(10000), [{ id: 'p1', costPrice: D(7000) }]);
    expect(res).toHaveLength(1);
    expect(res[0].productId).toBe('p1');
    expect(res[0].revenue.toString()).toBe('10000');
    expect(res[0].cost.toString()).toBe('7000');
  });

  it('allocates proportionally by cost; revenues sum EXACTLY to netAmount', () => {
    const res = allocateCashSaleByCost(D(1000), [
      { id: 'phone', costPrice: D(600) },
      { id: 'case', costPrice: D(400) },
    ]);
    expect(res.map((r) => r.revenue.toString())).toEqual(['600', '400']);
    expect(res.map((r) => r.cost.toString())).toEqual(['600', '400']);
    const sum = res.reduce((s, r) => s.plus(r.revenue), new Decimal(0));
    expect(sum.toString()).toBe('1000');
  });

  it('last product absorbs the rounding residual (sum stays exact)', () => {
    const res = allocateCashSaleByCost(D(1000), [
      { id: 'a', costPrice: D(1) },
      { id: 'b', costPrice: D(1) },
      { id: 'c', costPrice: D(1) },
    ]);
    // 1000 * 1/3 = 333.3333 → 333.33 each for a,b; c absorbs residual 333.34
    expect(res.map((r) => r.revenue.toString())).toEqual(['333.33', '333.33', '333.34']);
    const sum = res.reduce((s, r) => s.plus(r.revenue), new Decimal(0));
    expect(sum.toString()).toBe('1000');
  });

  it('zero total cost (give-away bundle) → all revenue on the main (first) product', () => {
    const res = allocateCashSaleByCost(D(500), [
      { id: 'main', costPrice: D(0) },
      { id: 'free', costPrice: D(0) },
    ]);
    expect(res.map((r) => r.revenue.toString())).toEqual(['500', '0']);
    expect(res.map((r) => r.cost.toString())).toEqual(['0', '0']);
  });

  it('empty products → empty allocation', () => {
    expect(allocateCashSaleByCost(D(100), [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

Run: `npm --prefix apps/api test -- src/modules/sales/shop-cash-sale-allocation.util.spec.ts`
Expected: FAIL ("Cannot find module './shop-cash-sale-allocation.util'").

- [ ] **Step 3: Implement** `shop-cash-sale-allocation.util.ts`:

```typescript
import { Decimal } from '@prisma/client/runtime/library';

export interface CashSaleProduct {
  id: string;
  costPrice: Decimal;
}

export interface CashSaleAllocation {
  productId: string;
  revenue: Decimal;
  cost: Decimal;
}

/**
 * Split a cash sale's net revenue across its products. `Sale` has no per-product
 * line price, so revenue is allocated proportionally by each product's `costPrice`
 * (confirmed default — spec §6B). The LAST product absorbs the rounding residual so
 * the allocated revenue sums EXACTLY to `netAmount`. If total cost is 0 (all
 * give-aways) all revenue lands on the first (main) product. Each product's `cost`
 * is its own `costPrice`.
 */
export function allocateCashSaleByCost(
  netAmount: Decimal,
  products: CashSaleProduct[],
): CashSaleAllocation[] {
  if (products.length === 0) return [];
  const net = new Decimal(netAmount.toString());
  const totalCost = products.reduce(
    (s, p) => s.plus(new Decimal(p.costPrice.toString())),
    new Decimal(0),
  );

  if (!totalCost.gt(0)) {
    return products.map((p, i) => ({
      productId: p.id,
      revenue: i === 0 ? net : new Decimal(0),
      cost: new Decimal(0),
    }));
  }

  const allocations: CashSaleAllocation[] = [];
  let allocated = new Decimal(0);
  products.forEach((p, i) => {
    const cost = new Decimal(p.costPrice.toString());
    let revenue: Decimal;
    if (i === products.length - 1) {
      revenue = net.sub(allocated); // last absorbs residual → exact sum
    } else {
      revenue = net.mul(cost).div(totalCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      allocated = allocated.plus(revenue);
    }
    allocations.push({ productId: p.id, revenue, cost });
  });
  return allocations;
}
```

- [ ] **Step 4: Run — expect PASS** (5 tests).

Run: `npm --prefix apps/api test -- src/modules/sales/shop-cash-sale-allocation.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/sales/shop-cash-sale-allocation.util.ts apps/api/src/modules/sales/shop-cash-sale-allocation.util.spec.ts
git commit -m "feat(sales): add allocateCashSaleByCost — split cash-sale revenue by product cost"
```

---

## Task 2: `ShopAccountResolver.resolveInflowCashAccount`

**Files:**
- Modify: `apps/api/src/modules/journal/shop-account-resolver.service.ts`
- Test: `apps/api/src/modules/journal/shop-account-resolver.service.spec.ts`

**Interfaces:**
- Consumes: existing `resolveBranchCashAccount(branchId, tx?)` + `SHOP_RECEIVING_BANK`.
- Produces: `resolveInflowCashAccount(branchId: string, paymentMethod: PaymentMethod | null | undefined, tx?: Prisma.TransactionClient): Promise<string>`

- [ ] **Step 1: Add the failing tests** to `shop-account-resolver.service.spec.ts`:

```typescript
it('resolveInflowCashAccount: CASH → the branch till', async () => {
  prisma.branch.findUnique.mockResolvedValue({ shopCashAccountCode: 'S11-1102' });
  await expect(resolver.resolveInflowCashAccount('br-1', 'CASH')).resolves.toBe('S11-1102');
});

it('resolveInflowCashAccount: non-CASH (transfer/QR) → the receiving bank S11-1201', async () => {
  await expect(resolver.resolveInflowCashAccount('br-1', 'BANK_TRANSFER')).resolves.toBe('S11-1201');
  await expect(resolver.resolveInflowCashAccount('br-1', 'QR_EWALLET')).resolves.toBe('S11-1201');
  expect(prisma.branch.findUnique).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL** (method undefined).

Run: `npm --prefix apps/api test -- src/modules/journal/shop-account-resolver.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add `PaymentMethod` to the `@prisma/client` import and this method to `ShopAccountResolver`:

```typescript
// import { Prisma, ProductCategory, PaymentMethod } from '@prisma/client';

/**
 * Resolve the SHOP cash/bank account that RECEIVES an inflow (cash sale, down
 * payment). CASH → the branch's physical till (fail-closed); any electronic method
 * (transfer/QR/etc.) → the single SHOP receiving bank S11-1201 (spec §5B).
 */
async resolveInflowCashAccount(
  branchId: string,
  paymentMethod: PaymentMethod | null | undefined,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  if (paymentMethod === 'CASH') {
    return this.resolveBranchCashAccount(branchId, tx);
  }
  return ShopAccountResolver.SHOP_RECEIVING_BANK;
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm --prefix apps/api test -- src/modules/journal/shop-account-resolver.service.spec.ts`
Expected: PASS (existing 4 + 2 new).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/journal/shop-account-resolver.service.ts apps/api/src/modules/journal/shop-account-resolver.service.spec.ts
git commit -m "feat(journal): ShopAccountResolver.resolveInflowCashAccount (CASH→till, else→receiving bank)"
```

---

## Task 3: Wire `ShopCashSaleTemplate` per-product at `createCashSale`

**Files:**
- Modify: `apps/api/src/modules/sales/services/sale-writer.service.ts` (ctor + `createCashSale`, replace the `W-007` TODO ~:147)
- Modify: `apps/api/src/modules/sales/sales.module.ts` (ensure `JournalModule` imported)
- Test: `apps/api/src/modules/sales/services/sale-writer.service.spec.ts`

**Interfaces:**
- Consumes: `ShopCashSaleTemplate.execute(input, outerTx?)` where `input = { idempotencyKey, saleId, cashAccountCode, revenueAccountCode, revenueAmount: Decimal, cogsAccountCode, inventoryAccountCode, inventoryCost: Decimal, postedAt? }`; `allocateCashSaleByCost` (Task 1); `ShopAccountResolver.resolveInflowCashAccount` (Task 2) + `resolveProductAccounts`.

- [ ] **Step 1: Write the failing tests** (`sale-writer.service.spec.ts`; mirror `contract-exchange.service.spec.ts` provider/mock-prisma setup; `$transaction = jest.fn(async (cb) => cb(tx))`). Cover: (a) single CASH product → one ShopCashSale JE with the product's category codes, key `shop-cash-sale:<saleId>:<productId>`, revenueAmount=netAmount, inventoryCost=costPrice, cashAccountCode=branch till; (b) bundle of 2 products (PHONE_NEW + ACCESSORY) → TWO JEs with per-product keys + cost-allocated revenue; (c) BANK_TRANSFER → cashAccountCode = `S11-1201`. Example assertion for (a):

```typescript
it('posts one ShopCashSale JE for a single CASH-paid product', async () => {
  tx.product.findMany.mockResolvedValue([{ id: 'p1', category: 'PHONE_NEW', costPrice: new Decimal(7000) }]);
  shopAccountResolver.resolveInflowCashAccount.mockResolvedValue('S11-1102');
  shopAccountResolver.resolveProductAccounts.mockReturnValue({ inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' });
  await service.createCashSale({ productId: 'p1', branchId: 'br-1', customerId: 'c1', sellingPrice: 10000, bundleProductIds: [], paymentMethod: 'CASH' } as any, 'sp-1', 10000, 0);
  expect(shopCashSaleTemplate.execute).toHaveBeenCalledTimes(1);
  const input = shopCashSaleTemplate.execute.mock.calls[0][0];
  expect(input).toMatchObject({ idempotencyKey: 'shop-cash-sale:sale-1:p1', saleId: 'sale-1', cashAccountCode: 'S11-1102', revenueAccountCode: 'S41-1101', cogsAccountCode: 'S50-1101', inventoryAccountCode: 'S11-2001' });
  expect(input.revenueAmount.toString()).toBe('10000');
  expect(input.inventoryCost.toString()).toBe('7000');
  expect(shopCashSaleTemplate.execute.mock.calls[0][1]).toBeDefined(); // tx passed
});
```

> Make `tx.sale.create` resolve `{ id: 'sale-1', ... }`, and stub `tx.product.update/updateMany`, `tx.commissionRule.findFirst`, `tx.salesCommission.create`, `verifyProductInStock`, `markBundleProductsSold`, `generateSaleNumber`. For (b) set `bundleProductIds:['p2']`, `tx.product.findMany` → `[{id:'p1',category:'PHONE_NEW',costPrice:D(6000)},{id:'p2',category:'ACCESSORY',costPrice:D(400)}]`, net 1000, and assert two execute calls with keys `...:p1`/`...:p2` and revenues `600`/`400` (resolveProductAccounts returns per-category — use `mockImplementation` keyed on the category arg).

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm --prefix apps/api test -- src/modules/sales/services/sale-writer.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add imports + required ctor deps to `SaleWriterService`:

```typescript
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentMethod } from '@prisma/client';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { allocateCashSaleByCost } from '../shop-cash-sale-allocation.util';
// constructor: add (after existing deps; required, no @Optional)
//   private shopCashSaleTemplate: ShopCashSaleTemplate,
//   private shopAccountResolver: ShopAccountResolver,
```

Replace the `W-007` TODO block in `createCashSale` (after the `sale.create` + product status update, inside the `$transaction`) with:

```typescript
      // SHOP-side: post one cash-sale JE per product (bundle-aware). Sale has no
      // per-product price, so revenue is allocated proportionally by product cost.
      const productIds = [dto.productId, ...(dto.bundleProductIds || [])];
      const prods = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, category: true, costPrice: true },
      });
      const ordered = productIds
        .map((id) => prods.find((p) => p.id === id))
        .filter((p): p is (typeof prods)[number] => !!p);
      const cashAccountCode = await this.shopAccountResolver.resolveInflowCashAccount(
        dto.branchId,
        dto.paymentMethod as PaymentMethod,
        tx,
      );
      const allocations = allocateCashSaleByCost(
        new Decimal(netAmount.toString()),
        ordered.map((p) => ({ id: p.id, costPrice: new Decimal(p.costPrice.toString()) })),
      );
      for (const alloc of allocations) {
        if (!alloc.revenue.gt(0)) continue; // template requires revenueAmount > 0
        const prod = ordered.find((p) => p.id === alloc.productId)!;
        const acc = this.shopAccountResolver.resolveProductAccounts(prod.category);
        await this.shopCashSaleTemplate.execute(
          {
            idempotencyKey: `shop-cash-sale:${sale.id}:${alloc.productId}`,
            saleId: sale.id,
            cashAccountCode,
            revenueAccountCode: acc.revenueAccountCode,
            revenueAmount: alloc.revenue,
            cogsAccountCode: acc.cogsAccountCode,
            inventoryAccountCode: acc.inventoryAccountCode,
            inventoryCost: alloc.cost,
          },
          tx,
        );
      }
```

- [ ] **Step 4: Ensure DI resolves.** Confirm `sales.module.ts` `imports` includes `JournalModule` (which exports `ShopCashSaleTemplate` + `ShopAccountResolver`); add it if missing. Then update EVERY TestingModule that constructs `SaleWriterService` (grep `rg -l "SaleWriterService" apps/api/src/modules/sales -g'*.spec.ts'`) to provide `{ provide: ShopCashSaleTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo:'JE-1', journalEntryId:'je-1' }) } }` and `{ provide: ShopAccountResolver, useValue: { resolveInflowCashAccount: jest.fn(), resolveProductAccounts: jest.fn() } }` (or add to positional `new SaleWriterService(...)` calls).

- [ ] **Step 5: Run — expect PASS** (whole sales suite) + typecheck.

Run: `npm --prefix apps/api test -- src/modules/sales && (cd apps/api && npx tsc --noEmit -p tsconfig.json)`
Expected: all sales suites PASS; tsc exit 0.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/sales/services/sale-writer.service.ts apps/api/src/modules/sales/services/sale-writer.service.spec.ts apps/api/src/modules/sales/sales.module.ts
git commit -m "feat(sales): post ShopCashSale per product at cash sale (bundle-aware, cost-allocated)"
```

---

## Acceptance
- `apps/api` tsc 0; full `src/modules/sales` suite green; `shop-cash-sale-allocation.util.spec.ts` + resolver spec green.
- A single-product CASH sale posts one balanced SHOP JE (Dr till / Cr S41 + Dr S50 / Cr S11-200x). A 2-category bundle posts two JEs whose revenues sum to `netAmount`. A BANK_TRANSFER sale debits `S11-1201`.
- Re-recording the same sale (same `saleId`) does not double-post (template idempotency on `shop-cash-sale:<saleId>:<productId>`).

## Open items (surface at review / to owner)
- **Revenue base = `netAmount` (after discount)** — discount reduces SHOP revenue, no separate discount contra (non-VAT SHOP). Confirm acceptable vs. booking gross revenue + a discount account.
- **`CREDIT_BALANCE` / `ONLINE_GATEWAY` payment methods** route to `S11-1201` like other non-cash methods. Confirm that's the right account for store-credit / gateway settlements, or refine `resolveInflowCashAccount`.
- Allocation-by-cost is a proxy (no per-product price exists). If a per-item price source is ever added (e.g. a `SaleItem` line model), switch the allocation to actual line prices.
