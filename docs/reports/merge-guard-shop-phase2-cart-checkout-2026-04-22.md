# Merge Guard Report — feature/shop-phase2-cart-checkout

**Date**: 2026-04-22  
**Branch**: `feature/shop-phase2-cart-checkout`  
**Base**: `origin/main`  
**Commits unique to branch**: 10 (cc249019…8e624a93)  
**Files changed**: ~80 files (+2,600 lines)  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| API — new modules | shop-cart, shop-checkout, shop-me, shop-orders, shop-shipping | 5 new NestJS modules |
| API — adapter | online-order-sale.adapter.ts | Bridges OnlineOrder → Sale on payment confirmation |
| API — paysolutions | paysolutions.service.ts (+283 lines) | New online-order payment intent logic |
| Frontend | apps/web-shop/ | Entire new storefront app (checkout flow, order pages) |
| Prisma | schema.prisma (+92), migrations (×2) | OnlineOrder model + migrations |

---

## Issues by Severity

### CRITICAL — Must fix before merge

#### C-1: `Number()` on money/Decimal fields — 7 locations

Using `Number()` to cast Prisma `Decimal` fields for arithmetic causes IEEE-754 floating-point precision loss on financial calculations. Per project rules, all money handling must use `Prisma.Decimal`.

| File | Line | Code |
|------|------|------|
| `shop-cart.service.ts` | ~44 | `sellingPrice: Number(r.product.costPrice)` |
| `shop-checkout.service.ts` | ~73 | `const price = Number(reservation.product.costPrice)` |
| `shop-checkout.service.ts` | ~77 | `Number(promo.value)` in percentage discount calc |
| `shop-checkout.service.ts` | ~79 | `Number(promo.value)` in fixed discount calc |
| `shop-checkout.service.ts` | ~109 | `const price = Number(reservation.product.costPrice)` in `placeOrder` |
| `online-order-sale.adapter.ts` | ~49 | `sellingPrice: Number(order.productPrice)` |
| `online-order-sale.adapter.ts` | ~51–52 | `Number(order.promoDiscount)`, `Number(order.loyaltyDiscount)`, `Number(order.totalAmount)` |

**Fix**: Replace `Number(decimal)` with `new Prisma.Decimal(decimal)` for arithmetic, and only convert to number at the final serialisation boundary (response DTO).

#### C-2: `ShopMeController` calls PrismaService directly

`apps/api/src/modules/shop-me/shop-me.controller.ts` injects `PrismaService` and issues DB queries directly from the controller — violates the mandatory controller → service → Prisma layering rule.

```ts
// shop-me.controller.ts — WRONG
constructor(private prisma: PrismaService) {}

async listAddresses(@Req() req) {
  const c = await this.prisma.customer.findUnique({ ... }); // ← direct DB call in controller
  ...
}
```

**Fix**: Extract `ShopMeService` and move all Prisma calls there.

#### C-3: `ShopOrdersService.getByOrderNumber` missing `deletedAt: null`

```ts
// shop-orders.service.ts ~23
const order = await this.prisma.onlineOrder.findUnique({
  where: { orderNumber },  // ← no deletedAt: null
  ...
});
```

A soft-deleted order can be retrieved and manipulated (bank slip upload, etc.).

**Fix**: Add `deletedAt: null` to the `where` clause.

#### C-4: `ShopCartController` computes `subtotal` using JS float arithmetic

```ts
// shop-cart.controller.ts ~14
const subtotal = items.reduce((a, i) => a + i.product.sellingPrice, 0);
```

`sellingPrice` is typed as `number` (converted from Decimal in service). The `+` operator on floating-point numbers accumulates rounding errors on financial totals.

**Fix**: Sum using `Prisma.Decimal` in the service, return the Decimal-serialised string.

---

### WARNING — Should fix

#### W-1: `sellingPrice` mapped from `costPrice` in `ShopCartService`

```ts
// shop-cart.service.ts ~44
sellingPrice: Number(r.product.costPrice),  // ← maps COST price to selling price
```

The cart item's displayed price is the product's cost price, not the selling price. This likely shows the wrong price to customers.

#### W-2: `PaymentStep.tsx` place-order mutation missing `queryClient.invalidateQueries`

After `place-order` succeeds, the cart/reservation is consumed but the cart query cache is not invalidated. On the same session, stale cart data may appear.

#### W-3: Pervasive `any` casts in critical flow paths

- `shop-checkout.service.ts:64` — `(promos as any[]).find((p: any) => ...)`
- `shop-checkout.service.ts:149` — `(this.paysolutions as any).createOnlineOrderIntent(...)` — bypasses TypeScript on payment gateway call
- `online-order-sale.adapter.ts:45` — `(this.sales as any).create(...)` — bypasses DTO ValidationPipe on Sale creation
- `shop-me.controller.ts:23` — `next as any` on customer address update

Type-safe alternatives exist (add the method to `PaySolutionsService`'s public interface, create a typed internal method on `SalesService`).

#### W-4: `ShopCheckoutController`, `ShopOrdersController`, `ShopMeController` missing `RolesGuard` + `@Roles()`

These controllers use `JwtAuthGuard` only. Per security rules, all authenticated controllers must also use `RolesGuard` with explicit `@Roles()` on every method. If these are customer-facing (shop JWT audience), a dedicated shop role or audience check must be explicit.

*Note*: `feat/admin-hardening-c3` adds `JwtAudienceGuard` that enforces `aud='shop'` for `/api/shop/*` paths — these two branches should be coordinated.

---

### INFO

#### I-1: `apps/web-shop/` ships its own shadcn/ui copies

`apps/web-shop/src/components/ui/` contains full inline copies of `button.tsx` (393 lines), `card.tsx`, `dialog.tsx`, etc. These diverge from `apps/web` and will need dual maintenance.

#### I-2: `feat/shop-phase2-cart-checkout` is not referenced in CLAUDE.md codebase structure

The new `apps/web-shop/` workspace is undocumented. Update `CLAUDE.md` on merge.

---

## Recommendation: **BLOCK**

Critical issues C-1 through C-4 must be resolved before merge:

- **C-1** (7×`Number()` on money) — financial precision risk on every transaction
- **C-2** (controller→Prisma direct) — violates mandatory architecture rule
- **C-3** (missing soft-delete guard) — security/data integrity bug
- **C-4** (float subtotal) — financial precision risk in cart display

After fixing critical issues, coordinate merge with `feat/admin-hardening-c3` (which adds the `JwtAudienceGuard` that properly secures the `/api/shop/*` endpoints introduced here).
