# Merge Guard Report — feat/shop-phase1-foundation

**Date:** 2026-04-21  
**Branch:** `feat/shop-phase1-foundation`  
**Author:** iamnaii (akenarin.ak@gmail.com)  
**Diff size:** 63 files changed, 46137 insertions(+), 16753 deletions(-)  
**Recommendation:** 🚫 BLOCK — 4 Critical issues must be resolved before merge

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| New API modules | `shop-auth-social`, `shop-bot-defense`, `shop-catalog`, `shop-line-chat`, `shop-reservation`, `shop-tracking` | 6 new NestJS modules |
| New frontend app | `apps/web-shop/` | Separate Vite app (port 5174) for online storefront |
| Schema | `apps/api/prisma/schema.prisma` | +157 lines (new shop models) |
| CORS | `apps/api/src/main.ts` | Adds `shop.bestchoicephone.app` + `localhost:5174` |
| App module | `apps/api/src/app.module.ts` | Registers all 6 new shop modules |
| package-lock.json | 1 file | +60249/-16753 lines — new `web-shop` dependencies |

---

## Issues by Severity

### 🔴 Critical

**C-1: `ShopReservationController` has ZERO guards**

```typescript
// apps/api/src/modules/shop-reservation/shop-reservation.controller.ts
@Controller('shop/reservations')
export class ShopReservationController {
  @Post()
  async create(@Body() dto: CreateReservationDto) { ... }

  @Delete(':id')
  async cancel(@Param('id') id: string, @Body('sessionId') sessionId: string) { ... }
}
```

`POST /shop/reservations` and `DELETE /shop/reservations/:id` have no guards of any kind — no `JwtAuthGuard`, no `ShopBotDefenseGuard`, no throttle. This is a **DoS vector**: any external actor can create unlimited reservations, locking products out of the catalog for 15 minutes and making them unavailable to real customers.

**Fix:** Add `@UseGuards(ShopBotDefenseGuard)` at minimum. If reservations require a logged-in shop customer, also add the shop JWT guard.

---

**C-2: `ShopAuthSocialController` has ZERO guards**

```typescript
// apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts
@Controller('shop/auth')
export class ShopAuthSocialController {
  @Post('line/callback')   // no guard
  @Post('facebook/callback') // no guard
  @Post('bind-phone')     // no guard — CRITICAL
}
```

`POST /shop/auth/line/callback` and `/facebook/callback` are OAuth callbacks — intentionally public. However, `POST /shop/auth/bind-phone` accepts arbitrary phone numbers with zero protection: no rate limiting, no bot defense, no OTP verification in the controller. An attacker could brute-force phone numbers to discover which customer accounts exist.

**Fix:**
- Apply `@UseGuards(ShopBotDefenseGuard)` to the controller class.
- Add explicit rate limiting on `bind-phone` (e.g., 5 attempts/IP/hour).
- Document `shop/auth` as an intentionally public path in `.claude/rules/security.md` if it must remain unguarded.

---

**C-3: `Number()` on money/price fields in `shop-catalog.service.ts`**

```typescript
// Line ~927:
const minPrice = Number(g._min?.costPrice ?? 0);  // costPrice is Decimal in DB

// Line ~968:
const price = Number(u.costPrice);  // same
```

`costPrice` is stored as `@db.Decimal(12, 2)` in the Prisma schema. Converting to JavaScript `Number` loses precision for values exceeding 15 significant digits — and is explicitly banned by project rules (`database.md`: "ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน").

**Fix:**
```typescript
// Replace:
const minPrice = Number(g._min?.costPrice ?? 0);
// With:
const minPrice = g._min?.costPrice ?? new Prisma.Decimal(0);

// Replace:
const price = Number(u.costPrice);
// With:
const price = new Prisma.Decimal(u.costPrice ?? 0);
```

---

**C-4: Shop JWT missing `aud: 'shop'` claim — incompatible with `admin-hardening-c3`**

```typescript
// apps/api/src/modules/shop-auth-social/shop-auth-social.service.ts
private async signToken(customerId: string): Promise<string> {
  return this.jwt.signAsync(
    { sub: customerId, role: 'CUSTOMER' },  // ← no aud claim
    { expiresIn: '7d' }
  );
}
```

The `JwtAudienceGuard` from `feat/admin-hardening-c3` enforces `aud === 'shop'` for all `/api/shop/*` routes. Shop customers issued tokens without `aud: 'shop'` will receive `403 Forbidden` on every shop API call once the hardening branch is live.

**Fix:**
```typescript
return this.jwt.signAsync(
  { sub: customerId, role: 'CUSTOMER', aud: 'shop', scope: 'shop:customer' },
  { expiresIn: '7d' }
);
```

---

### 🟡 Warning

**W-1: Network calls (`fetch()`) in controller instead of service**

```typescript
// ShopAuthSocialController — private methods doing HTTP:
private async exchangeLineCode(code: string) {
  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', ...);
  ...
}
private async exchangeFacebookToken(accessToken: string) {
  const res = await fetch(`https://graph.facebook.com/me?...`);
  ...
}
```

Controllers should orchestrate, not make network calls. These methods belong in `ShopAuthSocialService`. Moving them to the service enables proper mocking in tests and makes the controller unit-testable without network access.

**W-2: Missing Thai validation messages on auth DTOs**

```typescript
// social-login.dto.ts
export class LineLoginCallbackDto {
  @IsString()
  code!: string;  // no message: '...'
}
```

Project convention (`backend.md`) requires Thai error messages on all DTOs. Example: `@IsString({ message: 'กรุณาระบุ authorization code จาก LINE' })`.

**W-3: `ShopTrackingController` also has no guards**

`@Controller('shop')` with `@Post('track')` has no `ShopBotDefenseGuard`. While tracking is intentionally public, bots can flood analytics data. Add `@UseGuards(ShopBotDefenseGuard)` for consistency with `ShopCatalogController` and `ShopLineChatController`.

**W-4: `package-lock.json` is 60K lines in the diff**

This makes the diff nearly unreviable. Recommend splitting the `apps/web-shop` dependency installation into a separate commit or PR to isolate functional changes from lockfile noise.

### 🔵 Info

**I-1: Bot defense logic is well-designed**

`ShopBotDefenseService` correctly identifies AI crawlers (GPTBot, ClaudeBot, Anthropic-AI) and routes them to `LOGGED` rather than `BLOCKED`, which is the right call for legitimate AI discovery traffic.

**I-2: `shop-catalog.service.ts` has 178 lines — approaching the complexity limit**

Not an immediate concern but grouping/filtering/pagination logic could be extracted into a dedicated query-builder helper as the feature grows.

**I-3: 6 new modules, all registered in `app.module.ts`**

Module registration order is correct. CORS origins for `shop.bestchoicephone.app` and `localhost:5174` are properly added.

---

## Verdict

**🚫 BLOCK**

4 Critical issues must be fixed before this branch can merge:

| # | Issue | File |
|---|-------|------|
| C-1 | `ShopReservationController` — no guards (DoS vector) | `shop-reservation.controller.ts` |
| C-2 | `ShopAuthSocialController` — `bind-phone` unprotected | `shop-auth-social.controller.ts` |
| C-3 | `Number()` on `costPrice` Decimal field | `shop-catalog.service.ts` |
| C-4 | Missing `aud: 'shop'` in shop JWT — incompatible with admin-hardening-c3 | `shop-auth-social.service.ts` |

Recommended merge order after fixes: `feat/admin-hardening-c3` → `feat/shop-phase1-foundation`.
