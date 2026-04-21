# Merge Guard Report — feat/shop-phase1-foundation

**Date**: 2026-04-21  
**Branch**: `feat/shop-phase1-foundation`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Recommendation**: 🚫 BLOCK — Two unguarded controllers on mutating endpoints, money Decimal violations

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| Prisma schema | +1 migration, schema +157 lines | New shop models |
| `shop-auth-social` | controller, service, spec, DTO | Social login flow |
| `shop-bot-defense` | guard, service, spec | Rate-limit / bot protection |
| `shop-catalog` | controller, service, spec, DTO | Public product listing |
| `shop-line-chat` | controller, service | Contact inquiry |
| `shop-reservation` | controller, service, spec, DTO, cron | Product reservation |
| `shop-tracking` | controller, service, DTO | Anonymous analytics |
| `apps/web-shop/` | New Vite app skeleton | Customer-facing frontend |
| `package-lock.json` | +44k / -16k lines | Lockfile for new workspace |

**Total**: 63 files, ~46k insertions

---

## Issues

### Critical

**C-001 · `ShopReservationController` — unguarded mutating endpoints**  
`POST /shop/reservations` (create) and `DELETE /shop/reservations/:id` (cancel) have no guards of any kind — no `JwtAuthGuard`, no `ShopBotDefenseGuard`, no `@Roles()`. Per security rules, any controller without `JwtAuthGuard` that is not in the intentionally-public allowlist is a security bug. The shop reservations path is not in that list.

```ts
// apps/api/src/modules/shop-reservation/shop-reservation.controller.ts
@Controller('shop/reservations')
export class ShopReservationController {
  // No @UseGuards(), no @Roles()

  @Post()
  async create(@Body() dto: CreateReservationDto) { ... }

  @Delete(':id')
  async cancel(@Param('id') id: string, @Body('sessionId') sessionId: string) { ... }
}
```

The `cancel` endpoint is particularly risky: it accepts an arbitrary reservation `id` via URL and only requires a `sessionId` string in the body. There is no ownership check — any client that knows a reservation UUID can cancel it.

**Fix**: Add `@UseGuards(ShopBotDefenseGuard)` at minimum, or require a shop JWT. For the delete endpoint, add an ownership check in the service (verify `sessionId` matches the reservation's stored session).

---

**C-002 · `Number()` on money/price fields — `shop-catalog.service.ts`**  
Two uses of `Number()` directly on `Decimal` price columns violate the rule that money fields must use `Prisma.Decimal` throughout:

```ts
// apps/api/src/modules/shop-catalog/shop-catalog.service.ts
const minPrice = Number(g._min?.costPrice ?? 0);   // ← Decimal → float conversion loses precision
const price = Number(u.costPrice);                  // ← same issue
```

The calculated monthly payment (`calculateMonthlyPayment(minPrice, ...)`) is derived from `Number()`, so installment preview prices shown in the shop frontend may have floating-point rounding errors.

**Fix**: Use `new Prisma.Decimal(g._min?.costPrice ?? 0)` and pass `Prisma.Decimal` through the calculation helpers, or convert only at the final serialization boundary (after all arithmetic).

---

### Warning

**W-001 · `ShopTrackingController` — no bot-defense guard**  
`POST /shop/track` is intentionally public (anonymous page-view analytics) but has no `ShopBotDefenseGuard`. A malicious actor can flood the tracking endpoint and inflate analytics data or exhaust DB write capacity. The global `ThrottlerGuard` (200 req/sec total) provides some protection but no per-IP or per-session limiting for this endpoint.

```ts
// apps/api/src/modules/shop-tracking/shop-tracking.controller.ts
@Controller('shop')
export class ShopTrackingController {
  // No guards — should have @UseGuards(ShopBotDefenseGuard)
```

---

**W-002 · `ShopAuthSocialController` — missing fallback on `SHOP_BASE_URL` env var**  
```ts
// apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts:32
redirect_uri: process.env.SHOP_BASE_URL + '/auth/line-callback',
```
If `SHOP_BASE_URL` is not set, `redirect_uri` becomes `"undefined/auth/line-callback"`. LINE will reject the OAuth callback with an invalid redirect_uri error. There is no corresponding entry for `SHOP_BASE_URL` in `.env.example`.

**Fix**: Add `SHOP_BASE_URL` to `.env.example` and add a startup validation (or at minimum a runtime `if (!process.env.SHOP_BASE_URL) throw new Error(...)` in the module init).

---

**W-003 · Missing Thai validation messages on `CreateReservationDto`**  
```ts
// apps/api/src/modules/shop-reservation/dto/create-reservation.dto.ts
@IsUUID()
productId!: string;

@IsString()
sessionId!: string;
```
No `{ message: '...' }` options on the validators. Backend rule requires Thai error messages on all DTOs. This only affects error responses, not functionality, but is inconsistent with the rest of the codebase.

---

### Info

**I-001 · `ShopAuthSocialController` is correctly public**  
Auth endpoints (`/shop/auth/*`) are analogous to `/api/auth/*` which is in the public allowlist — no `JwtAuthGuard` needed on social login callbacks. This is correct.

**I-002 · `ListProductsDto` uses `@IsInt()` for price range filters**  
`minPrice`/`maxPrice` are validated as integers. If the product catalog ever supports decimal prices, these validators would need updating. Consider `@IsNumber()` with a `@Min(0)` for future-proofing, though not a blocking issue.

**I-003 · Large lockfile change (+44k lines)**  
The `package-lock.json` diff is very large due to the new `apps/web-shop/` workspace. Review the new dependency tree for known-vulnerable packages before merge (`npm audit`).

---

## Verdict

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Warning | 3 |
| Info | 3 |

**🚫 BLOCK** — C-001 (unguarded mutating reservation endpoints) is a direct security issue; C-002 (Decimal precision loss on displayed prices) is a financial accuracy bug. Both must be fixed. Recommend also resolving W-001 and W-002 before merge.
