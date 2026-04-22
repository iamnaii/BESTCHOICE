# Pre-Merge Guard Report — feature/shop-phase2-cart-checkout

**Date**: 2026-04-22  
**Branch**: `feature/shop-phase2-cart-checkout`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last commit**: 2026-04-21 16:59 +0700  
**Commits ahead of main**: 18  
**Recommendation**: 🔴 **BLOCK** — fix Criticals before merge

---

## File Changes Summary

78 files changed, 4,008 insertions(+), 26 deletions(-)

New modules:
- `shop-shipping` — static shipping rate table
- `shop-cart` — session-based anonymous cart
- `shop-checkout` — promo/loyalty validation, place-order
- `shop-orders` — OnlineOrder CRUD + OnlineOrderSaleAdapter
- `shop-me` — customer address book (`/api/shop/me/addresses`)

Existing modules modified:
- `paysolutions.service.ts` — online-order payment intent + webhook routing
- `app.module.ts` — 5 new shop modules registered
- `jwt.strategy.ts` — shop/customer JWT path (aud='shop')
- `line-oa-payment.controller.ts` — guard against null-contract payment links

---

## Issues

### 🔴 Critical

#### C-1: `Number()` on Decimal money fields — `shop-cart.service.ts`
**File**: `apps/api/src/modules/shop-cart/shop-cart.service.ts` ~line 711

```ts
sellingPrice: Number(r.product.costPrice),  // ❌ Number() on Decimal
```

Rule violation: money fields must use `Prisma.Decimal`, never `Number()`.  
This causes silent precision loss on amounts like 10,999.99.

#### C-2: Wrong field — `costPrice` served as `sellingPrice`
**File**: `apps/api/src/modules/shop-cart/shop-cart.service.ts` ~line 711  
**Also**: `apps/api/src/modules/shop-checkout/shop-checkout.service.ts` ~lines 1092, 1126

```ts
// shop-cart.service.ts
sellingPrice: Number(r.product.costPrice),  // ❌ maps costPrice → sellingPrice

// shop-checkout.service.ts
const price = Number(reservation.product.costPrice);  // ❌ used as selling price for promo calc
```

`costPrice` = what SHOP paid the supplier.  
`sellingPrice` = what the customer pays.  
Serving `costPrice` as the selling price means:
- The shop frontend displays cost-price to buyers
- Promo discounts are computed against cost, not selling price
- Revenue will be under-reported if order amounts are based on costPrice

**Action required**: Verify whether `Product` has a separate `sellingPrice` field in the schema. If yes, use it. If SHOP encodes selling price in `costPrice` for the online store, add a comment explaining why.

#### C-3: Multiple `Number()` calls on Decimal fields — `shop-checkout.service.ts`
**File**: `apps/api/src/modules/shop-checkout/shop-checkout.service.ts`

```ts
const price = Number(reservation.product.costPrice);           // ❌
discount = Math.floor((price * Number(promo.value)) / 100);    // ❌
discount = Math.min(price, Number(promo.value));               // ❌
```

All three use `Number()` on `Prisma.Decimal` fields. Replace with `Prisma.Decimal` arithmetic via `d()` util.

#### C-4: Multiple `Number()` calls on Decimal fields — `online-order-sale.adapter.ts`
**File**: `apps/api/src/modules/shop-orders/online-order-sale.adapter.ts` ~lines 1304–1307

```ts
sellingPrice: Number(order.productPrice),                            // ❌
discount: Number(order.promoDiscount) + Number(order.loyaltyDiscount), // ❌
amountReceived: Number(order.totalAmount),                           // ❌
```

Use `Prisma.Decimal` arithmetic. The `d()` utility in `decimal.util.ts` already exists for this purpose.

---

### ⚠️ Warning

#### W-1: `ShopCartController` — missing `JwtAuthGuard`
**File**: `apps/api/src/modules/shop-cart/shop-cart.controller.ts`

```ts
@Controller('shop/cart')
@UseGuards(ShopBotDefenseGuard)   // ⚠️ ShopBotDefenseGuard only — no JwtAuthGuard
export class ShopCartController { ... }
```

The security rules state all controllers must have `@UseGuards(JwtAuthGuard, RolesGuard)` unless listed as intentionally public. The cart endpoint appears intentionally public (session-based anonymous cart), similar to `address` or `paysolutions`. However, it is **not documented** in `.claude/rules/security.md` under "Intentionally Public Endpoints."

**Action**: Either add `JwtAuthGuard` (customers authenticate before adding to cart), or add an entry to the security rules documenting `/shop/cart` as intentionally public with the reason (anonymous session-based cart).

#### W-2: `ShopShippingController` — same issue as W-1
**File**: `apps/api/src/modules/shop-shipping/shop-shipping.controller.ts`

```ts
@Controller('shop/shipping')
@UseGuards(ShopBotDefenseGuard)   // ⚠️ no JwtAuthGuard
```

Same pattern — public endpoint for fetching shipping methods. Document in security.md.

#### W-3: `createOnlineOrderIntent` — `number` passed to Decimal column
**File**: `apps/api/src/modules/paysolutions/paysolutions.service.ts` ~line 343

```ts
amount: input.amount,  // ⚠️ input.amount is `number`, paymentLink.amount is Decimal
```

Prisma accepts JS numbers for Decimal fields but this is not the preferred pattern and can lose precision for amounts > 2^53. Use `new Prisma.Decimal(input.amount)`.

---

### ℹ️ Info

#### I-1: `buildOrderPaidFlex` — hardcoded hex colors in LINE flex message
**File**: `apps/api/src/modules/paysolutions/paysolutions.service.ts`

```ts
{ type: 'text', text: order.product.name, size: 'sm', color: '#666666' },
```

Hardcoded hex colors are fine in LINE flex messages (LINE's API requires hex, not CSS variables). Not a violation — noting for awareness only.

#### I-2: Frontend `sellingPrice` typed as `number` in web-shop types
**File**: `apps/web-shop/src/types/product.ts`

`sellingPrice: number` — the web-shop type mirrors the backend shape. If the backend C-2 is fixed to use Decimal, the web type should remain `number` (serialized over HTTP as float). No change needed here, but verify alignment with backend fix.

---

## Summary Table

| # | Severity | File | Description |
|---|----------|------|-------------|
| C-1 | 🔴 Critical | `shop-cart.service.ts:711` | `Number()` on Decimal `costPrice` |
| C-2 | 🔴 Critical | `shop-cart.service.ts:711`, `shop-checkout.service.ts:1092,1126` | `costPrice` used as `sellingPrice` — wrong field |
| C-3 | 🔴 Critical | `shop-checkout.service.ts:1092-1097` | 3× `Number()` on Decimal in promo calc |
| C-4 | 🔴 Critical | `online-order-sale.adapter.ts:1304-1307` | 3× `Number()` on Decimal in sale record |
| W-1 | ⚠️ Warning | `shop-cart.controller.ts` | No `JwtAuthGuard` — not in public endpoint allow-list |
| W-2 | ⚠️ Warning | `shop-shipping.controller.ts` | No `JwtAuthGuard` — not in public endpoint allow-list |
| W-3 | ⚠️ Warning | `paysolutions.service.ts:343` | JS `number` passed to Decimal column |
| I-1 | ℹ️ Info | `paysolutions.service.ts` | Hex colors in LINE flex (acceptable) |
| I-2 | ℹ️ Info | `web-shop/types/product.ts` | `sellingPrice: number` on frontend |

---

## Recommendation

**🔴 BLOCK** — 4 Critical issues must be fixed before merge:

1. Replace all `Number(decimal_field)` calls with `Prisma.Decimal` arithmetic using the existing `d()` utility
2. Verify correct price field (`sellingPrice` vs `costPrice`) in cart, checkout, and promo calculation
3. Document `shop/cart` and `shop/shipping` as intentionally public in `.claude/rules/security.md`
