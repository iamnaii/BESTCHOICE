# Merge Guard Report — feat/shop-phase1-foundation

**Date**: 2026-04-20  
**Branch**: `feat/shop-phase1-foundation`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Recommendation**: 🚫 **BLOCK** — 3 Critical issues must be resolved before merge

---

## File Changes Summary

65 files changed, 50,680 insertions(+), 16,753 deletions(-)

| Area | Files | Notes |
|------|-------|-------|
| `apps/api/src/modules/shop-auth-social/` | 3 | Social login (LINE/FB OAuth + phone binding) |
| `apps/api/src/modules/shop-bot-defense/` | 3 | Rate-limit guard for public shop endpoints |
| `apps/api/src/modules/shop-catalog/` | 4 | Product catalog with groupBy + pricing |
| `apps/api/src/modules/shop-line-chat/` | 3 | Contact inquiry → LINE notification |
| `apps/api/src/modules/shop-reservation/` | 4 | Anonymous product reservations with TTL |
| `apps/api/src/modules/shop-tracking/` | 4 | Page visit analytics |
| `apps/web-shop/` | 30+ | New Vite/React app — online shop frontend |
| `prisma/schema.prisma` | 1 | +153 lines (new shop models) |
| `package-lock.json` | 1 | +~60K lines (new workspace) |

**What the branch does**: Introduces a new public-facing online shop (`apps/web-shop`) and 6 new NestJS modules to serve it (`shop-auth-social`, `shop-bot-defense`, `shop-catalog`, `shop-line-chat`, `shop-reservation`, `shop-tracking`). The shop allows customers to browse stock, reserve products, and log in via LINE/Facebook OAuth.

---

## Issues Found

### Critical (must fix before merge)

**C-1 — `ShopReservationController` has NO guards** (`shop-reservation.controller.ts`)

```ts
@Controller('shop/reservations')
export class ShopReservationController {          // ← no @UseGuards
  @Post()
  async create(@Body() dto: CreateReservationDto) { ... }   // ← no @Roles

  @Delete(':id')
  async cancel(@Param('id') id: string, ...) { ... }        // ← no @Roles
}
```

`DELETE /api/shop/reservations/:id` accepts any `sessionId` in the body without verifying ownership. An attacker can enumerate UUIDs and cancel any customer's reservation. `POST /shop/reservations` is a denial-of-service vector (unlimited reservation creation). Even if reservations are anonymous-session-based, the `ShopBotDefenseGuard` must be applied and the cancel endpoint must verify sessionId matches the reservation's stored sessionId server-side.

_Fix_: Add `@UseGuards(ShopBotDefenseGuard)` to the class; add server-side session ownership check in `ShopReservationService.cancel()`.

---

**C-2 — `ShopTrackingController` has NO guards** (`shop-tracking.controller.ts`)

```ts
@Controller('shop')
export class ShopTrackingController {             // ← no @UseGuards
  @Post('track')
  async track(@Body() dto: TrackVisitDto, ...) { ... }      // ← no @Roles
}
```

`POST /api/shop/track` is completely unprotected. With no rate limiting, an attacker can flood this endpoint to bloat the analytics table. `TrackVisitDto.sessionId` and `pagePath` also lack `@MaxLength` constraints, allowing arbitrarily large payloads.

_Fix_: Add `@UseGuards(ShopBotDefenseGuard)`, and add `@MaxLength(64)` to `sessionId`, `@MaxLength(500)` to `pagePath` in `TrackVisitDto`.

---

**C-3 — `bindPhoneToSocial` trusts client for OTP verification** (`shop-auth-social.service.ts`, `shop-auth-social.controller.ts`)

```ts
// shop-auth-social.service.ts line ~60
async bindPhoneToSocial(input: { phone, provider, providerUserId }): Promise<SocialLoginResult> {
  // Note: assumes phone OTP already verified by caller  ← ⚠️ no server-side proof!
  const customer = await this.prisma.customer.findFirst({ where: { phone: input.phone, ... } });
  await this.prisma.customer.update({ data: { facebookUserId: input.providerUserId } });
  const token = await this.signToken(customer.id); // issues a 7-day JWT
}
```

The endpoint `POST /shop/auth/bind-phone` issues a 7-day customer JWT after accepting `{ phone, provider, providerUserId }` with zero server-side proof that the caller controls the phone number. An attacker can send any `phone + providerUserId` pair to hijack any customer account (if they know the phone number and provide their own Facebook/LINE user ID). The comment "assumes phone OTP already verified by caller" means OTP validation is expected in the frontend — which is client-side trust, a textbook authentication bypass.

_Fix_: Require a short-lived OTP token (issued by server after OTP delivery + verification) as proof. The `BindPhoneDto` should include an `otpToken` field. The service must validate this token server-side before issuing the JWT.

---

### Warning

**W-1 — `Number()` on Decimal money fields** (`shop-catalog.service.ts`)

```ts
const minPrice = Number(g._min?.costPrice ?? 0);  // costPrice is Prisma.Decimal
const price = Number(u.costPrice);                // loses precision
```

`costPrice` is declared as `@db.Decimal(12, 2)` in schema. Casting to JS `number` via `Number()` introduces floating-point rounding errors (e.g. `Number(new Decimal('1999.99'))` may produce `1999.9900000000002`). Per project rules: use `Prisma.Decimal` throughout, or call `.toNumber()` only at the final serialization boundary with explicit rounding.

_Fix_: Use `new Prisma.Decimal(g._min?.costPrice ?? 0)` and keep arithmetic in Decimal until the final `toNumber()` before returning to client.

---

**W-2 — Raw `fetch()` in `ShopAuthSocialController`** (`shop-auth-social.controller.ts`)

```ts
const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', { ... });
const res = await fetch(`https://graph.facebook.com/me?...&access_token=...`);
```

Project rules: use NestJS `HttpService` (`@nestjs/axios`) for all HTTP calls. Raw `fetch()` bypasses Axios interceptors (no retry logic, no observability). The Facebook URL also embeds the `access_token` in the URL query string — it will appear in server access logs in plaintext.

_Fix_: Use `HttpService.post()` / `HttpService.get()`. Move FB `access_token` to an `Authorization: Bearer` header.

---

**W-3 — `ShopAuthSocialController` not in the intentionally-public allowlist** (`security.md`)

The controller has no `@UseGuards(JwtAuthGuard)` and is not listed in `.claude/rules/security.md` "Intentionally Public Endpoints". Security reviewers will flag this as a bug on every future review.

_Fix_: Add `shop-auth-social` to the intentionally-public list in `security.md` with a comment explaining OAuth callback flow rationale.

---

**W-4 — `where: any` TypeScript type** (`shop-catalog.service.ts:~62`)

```ts
const where: any = { deletedAt: null, isOnlineVisible: true, ... };
```

Using `any` defeats type checking on the Prisma query predicate — typos in field names will not be caught at compile time.

_Fix_: Use `Prisma.ProductWhereInput` from `@prisma/client`.

---

**W-5 — Hardcoded production URL** (`apps/web-shop/src/lib/api.ts`)

```ts
baseURL: import.meta.env.PROD ? 'https://bestchoicephone.app' : '',
```

Production base URL should be an env var (`VITE_API_BASE_URL`) so it can be overridden in staging without a code change.

---

### Info

**I-1 — Missing `@MaxLength` on session/path DTOs**  
`CreateReservationDto.sessionId` and `TrackVisitDto.sessionId`/`pagePath` have no maximum length. A payload with a 1MB `sessionId` string will pass validation and hit the DB insert.

**I-2 — `ProductDetailPage.tsx` is 1 line (placeholder)**  
File contains only `export default function ProductDetailPage() {}`. This will 404 with no content on `/shop/products/:id`. Acceptable for Phase 1 if `/products/:id` is not linked from the catalog, but should be tracked.

**I-3 — `package-lock.json` has ~76k line changes**  
New `apps/web-shop` workspace adds significant lockfile churn. Verify no unexpected packages were introduced (audit: `npm audit --workspace=apps/web-shop`).

**I-4 — `INTEREST_RATE_PER_MONTH` hardcoded in service**  
`const INTEREST_RATE_PER_MONTH = 0.0099;` is hardcoded in `shop-catalog.service.ts` with a comment "adjust per pricing config". This will produce stale pricing if the rate changes and no one remembers to update the constant. Pull from the existing `InterestConfig` table used by the main app.

---

## Security Assessment Summary

| Risk | Details |
|------|---------|
| Account takeover | C-3 — phone binding issues JWT without server OTP proof |
| Reservation DoS | C-1 — no rate limit on `POST /shop/reservations` |
| Reservation cancellation abuse | C-1 — `DELETE` doesn't verify session ownership server-side |
| Analytics flood | C-2 — no throttle on `POST /shop/track` |
| Token exfiltration via logs | W-2 — Facebook access_token in URL query string |
