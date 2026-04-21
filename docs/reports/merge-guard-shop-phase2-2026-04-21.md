# Pre-Merge Guard Report — feature/shop-phase2-cart-checkout

**Date:** 2026-04-21
**PR:** #628 — feat(shop): Phase 2 — Cart + Cash Checkout (18 commits)
**Author:** Akenarin Kongdach
**Branch:** `feature/shop-phase2-cart-checkout` → `main`
**Files changed:** 78 files (+4,008 / -26)

---

## File Changes Summary

| Area | Key additions |
|------|---------------|
| API — new modules | `shop-shipping`, `shop-cart`, `shop-checkout`, `shop-orders`, `shop-me` |
| API — modified | `paysolutions.service.ts`, `jwt.strategy.ts`, `line-oa-payment.controller.ts` |
| DB — new model | `OnlineOrder`, 2 migrations (`20260529200000`, `20260530000000`) |
| Frontend (web-shop) | `CartPage`, `CheckoutPage` (3-step), `OrderSuccessPage`, `OrdersPage`, `OrderDetailPage`, `AccountPage`, `AddressBookPage` + components |
| Tests | +13 Jest tests (shop-shipping/3, shop-cart/2, shop-checkout/8), 1 E2E scaffold (skipped) |

---

## Issues by Severity

### 🔴 Critical — MUST FIX BEFORE MERGE

#### C-1: `Number()` on Prisma Decimal money fields — 6 violations

Using `Number()` on Decimal fields loses precision (floating-point rounding) and violates the project's **mandatory rule** (`database.md`: "ใช้ Decimal เท่านั้น — ห้ามใช้ Float หรือ Number สำหรับจำนวนเงิน").

| File | Line (approx.) | Code |
|------|---------------|------|
| `shop-cart/shop-cart.service.ts` | ~37 | `sellingPrice: Number(r.product.costPrice)` |
| `shop-checkout/shop-checkout.service.ts` | ~83, ~127 | `const price = Number(reservation.product.costPrice)` (×2) |
| `shop-checkout/shop-checkout.service.ts` | ~83 | `Math.floor((price * Number(promo.value)) / 100)` |
| `shop-orders/online-order-sale.adapter.ts` | ~55–58 | `Number(order.productPrice)`, `Number(order.promoDiscount)`, `Number(order.loyaltyDiscount)`, `Number(order.totalAmount)` |

**Fix:** Replace with `d(...)` (the project's `decimal.util` helper) or `new Prisma.Decimal(...)`. For display-only (frontend), `Number()` is acceptable on the React side but should not be used server-side for calculations.

---

#### C-2: `costPrice` exposed as `sellingPrice` to customers

In `shop-cart/shop-cart.service.ts` (~line 37):
```ts
product: {
  sellingPrice: Number(r.product.costPrice),  // ← maps internal costPrice as sellingPrice
```

`costPrice` is the internal purchase/cost field. `sellingPrice` is the customer-facing price. This bug (a) exposes internal margins to customers and (b) calculates order totals from cost rather than selling price, meaning the shop charges wrong amounts.

**Fix:** Use the correct field — `r.product.sellingPrice` (verify the Prisma model has this field; if not, it may be stored differently on `Product`). Also the same mistake is repeated in `shop-checkout.service.ts` lines 83 and 127: `const price = Number(reservation.product.costPrice)` should be `reservation.product.sellingPrice`.

---

### 🟡 Warning — SHOULD FIX BEFORE MERGE

#### W-1: `JwtAudienceGuard` referenced in comments but never implemented

Three code comments describe `JwtAudienceGuard` as an existing, enforcing guard:

- `jwt.strategy.ts`: *"JwtAudienceGuard enforces the aud claim at route level"*
- `shop-auth-social.service.ts`: *"global JwtAudienceGuard blocks /api/shop/* when aud claim is anything other than 'shop'"*
- `shop-orders.admin.controller.ts`: *"JwtAudienceGuard enforces aud='admin' automatically"*

**The guard file does not exist** in this branch or on `main`. The `jwt.strategy.ts` change does route customer/admin lookups based on `aud`, but there is no guard that prevents a Customer JWT (`aud='shop'`) from hitting admin routes, or an Admin JWT from hitting shop customer routes.

Current risk level is **low** (admin routes still protected by `RolesGuard`; shop routes return empty/forbidden for wrong IDs), but the comments are misleading and the design intent is not fulfilled.

**Fix:** Either implement a `JwtAudienceGuard` that validates `req.user.aud` against the expected audience for each route group (`/api/shop/*` requires `aud='shop'`), or remove the misleading comments.

---

#### W-2: `ShopMeController.addAddress` accepts unvalidated body

`shop-me/shop-me.controller.ts`:
```ts
@Post('addresses')
async addAddress(@Req() req, @Body() addr: Record<string, unknown>) {
```

No DTO, no `class-validator` decorators. Arbitrary JSON is stored directly in `customer.shippingAddresses` (a `Json` column). A malicious customer could inject large objects, special characters, or unexpected keys.

**Fix:** Create a `SaveAddressDto` with `@IsString() @IsNotEmpty()` on `recipientName`, `phone`, `line1`, `subDistrict`, `district`, `province`, `postalCode` — matching the `ShippingAddressDto` already defined in `shop-checkout/dto/place-order.dto.ts`.

---

#### W-3: No `@Roles()` decorator on `ShopCheckoutController`, `ShopOrdersController`, `ShopMeController`

Per `security.md` and project conventions, every protected controller method requires `@Roles()`. These three controllers use `@UseGuards(JwtAuthGuard)` only:

```ts
@Controller('shop/checkout')
@UseGuards(JwtAuthGuard)   // missing @Roles()
export class ShopCheckoutController { ... }
```

For customer-facing endpoints, `@Roles('CUSTOMER')` is appropriate — this also serves as documentation that these endpoints are intentionally for customers, not staff.

**Fix:** Add `@Roles('CUSTOMER')` at class level on `ShopCheckoutController`, `ShopOrdersController`, and `ShopMeController`. Ensure `RolesGuard` is in the guard chain.

---

### 🔵 Info

#### I-1: `ShopCartController` and `ShopShippingController` are intentionally public (session-based / static data)

Both use `ShopBotDefenseGuard` only, no JWT. This appears intentional:
- `ShopShippingController.listMethods()` — static rate table (analogous to the public `address` endpoint)
- `ShopCartController.get()` — session-based anonymous cart via `x-shop-session` header

No action required, but consider adding an explicit comment (or listing these in `security.md`'s "Intentionally Public Endpoints" section) to prevent future confusion.

---

#### I-2: `ShopOrdersAdminController` — broad class-level `@Roles`

The class-level decorator `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` permits all staff roles for `ship` and `deliver` actions. Method-level overrides exist only for `confirmBank` and `cancel`. This may be intentionally permissive — verify with business owner that SALES staff should be able to mark orders shipped/delivered.

---

## Recommendation

**🔴 BLOCK — Do not merge until C-1 and C-2 are resolved.**

C-2 (`costPrice` exposed as `sellingPrice`) is a business-breaking bug: all cart subtotals and order totals would be calculated from internal cost prices rather than selling prices, causing incorrect charges to customers.

C-1 (`Number()` on Decimal) violates the project's money-handling policy and risks rounding errors on financial amounts.

W-1, W-2, W-3 should also be addressed before merge but are not blocking by themselves.

### Suggested fix order
1. Fix `costPrice → sellingPrice` throughout `shop-cart.service.ts` and `shop-checkout.service.ts`
2. Replace all `Number(...)` with `d(...)` / `Prisma.Decimal` in service-layer calculations
3. Create `SaveAddressDto` and apply to `ShopMeController.addAddress`
4. Add `@Roles('CUSTOMER')` + `RolesGuard` to the three shop customer controllers
5. Implement or remove `JwtAudienceGuard` and its comments
