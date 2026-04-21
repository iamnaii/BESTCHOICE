# Merge Guard Report — feat/shop-phase1-foundation

**Date**: 2026-04-21  
**Branch**: `feat/shop-phase1-foundation`  
**Author**: Akenarin Kongdach  
**Recommendation**: 🚫 BLOCK — 2 Critical issues must be fixed before merge

---

## File Changes Summary

63 files changed, 46137 insertions, 16753 deletions (majority is `package-lock.json`)

| Area | Files |
|------|-------|
| New frontend app | `apps/web-shop/` — Vite SPA (pages, layout, API client, tracking) |
| API — new modules | `shop-auth-social`, `shop-bot-defense`, `shop-catalog`, `shop-line-chat`, `shop-reservation`, `shop-tracking` |
| API — modified | `app.module.ts` (registers 6 new modules), `main.ts` (CORS origins) |
| DB | `schema.prisma` + migration (new shop tables) |
| Deps | `package-lock.json` — large diff (needs `npm audit`) |

---

## Issues

### 🚫 Critical — `bind-phone` Endpoint Has No OTP Verification

**File**: `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` L22–24  
**File**: `apps/api/src/modules/shop-auth-social/shop-auth-social.service.ts` L67–68

```ts
// Controller — no guard, no OTP check
@Post('bind-phone')
async bindPhone(@Body() dto: BindPhoneDto) {
  return this.authService.bindPhoneToSocial(dto);
}

// Service — comment says "assumes caller verified" with no enforcement
async bindPhoneToSocial(input: { phone: string; provider: 'LINE' | 'FACEBOOK'; providerUserId: string }) {
  // Note: assumes phone OTP already verified by caller
  const customer = await this.prisma.customer.findFirst({ where: { phone: input.phone, deletedAt: null } });
```

`POST /shop/auth/bind-phone` is completely unauthenticated. Any party who knows a customer's phone number can call this endpoint and link their own LINE/Facebook account to that customer's profile, gaining full shop session access as that customer. The comment is not enforcement.

**Fix**: 
1. Issue a short-lived `aud: 'phone_otp_verified'` JWT after OTP verification and require it on `bind-phone` via `@RequireAudience('phone_otp_verified')`.
2. Alternatively, implement an OTP verification step within this endpoint before performing the bind.

---

### 🚫 Critical — `Number()` on Decimal Money Fields

**File**: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`

```ts
const minPrice = Number(g._min?.costPrice ?? 0);
const price = Number(u.costPrice);
```

`costPrice` is a `Decimal @db.Decimal(12,2)` field. Converting via `Number()` loses precision for large values and violates the project's "use `Prisma.Decimal` for all money" rule (database.md).

**Fix**: Use `new Prisma.Decimal(g._min?.costPrice ?? 0)` and return as string `price.toFixed(2)` at the DTO boundary, or serialise as `Prisma.Decimal` directly.

---

### ⚠️ Warning — `ShopReservationController` Has No Guards (Undocumented Public Endpoint)

**File**: `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts`

```ts
@Controller('shop/reservations')
export class ShopReservationController {
  // No @UseGuards decorator
  @Post()  async create(@Body() dto: CreateReservationDto) { ... }
  @Delete(':id')  async cancel(...) { ... }
}
```

Neither endpoint has `@UseGuards`. Per `security.md`, controllers without guards that are not in the "Intentionally Public Endpoints" list are security bugs. The cancellation relies only on a `sessionId` body parameter — anyone can spam-create reservations, holding inventory for 15 minutes per request.

**Fix**: Either add this to the documented public endpoints list in `security.md` with a rationale (e.g., `ShopBotDefenseGuard` provides rate-limiting), or add `@UseGuards(ShopBotDefenseGuard)` (already used on catalog/contact) to at least the `@Post()` create endpoint.

---

### ⚠️ Warning — `ShopTrackingController` Has No Guards (Undocumented Public Endpoint)

**File**: `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts`

```ts
@Controller('shop')
export class ShopTrackingController {
  // No @UseGuards decorator
  @Post('track')
  async track(@Body() dto: TrackVisitDto, @Req() req: Request) { ... }
}
```

`POST /shop/track` accepts anonymous tracking events without any rate-limiting guard. While anonymous tracking is intentional, this endpoint has no bot defense, allowing bulk data injection into the `websiteVisit` table. The catalog and contact controllers use `@UseGuards(ShopBotDefenseGuard)` — this one should too.

**Fix**: Add `@UseGuards(ShopBotDefenseGuard)` and document as intentionally public in `security.md`.

---

### ⚠️ Warning — Shop JWT Tokens Lack `aud: 'shop'` Claim

**File**: `apps/api/src/modules/shop-auth-social/shop-auth-social.service.ts` L84

```ts
private async signToken(customerId: string): Promise<string> {
  return this.jwt.signAsync({ sub: customerId, role: 'CUSTOMER' }, { expiresIn: '7d' });
}
```

When `feat/admin-hardening-c3` is also merged, `JwtAudienceGuard` will reject these tokens on all `/api/shop/*` endpoints because they lack `aud: 'shop'`. Add `aud: 'shop'` to the token payload.

---

### ⚠️ Warning — Large `package-lock.json` Diff Needs Audit

The diff includes 60k+ lines of `package-lock.json` changes from adding the new `apps/web-shop` workspace. Run `npm audit` to confirm no high/critical vulnerabilities are introduced.

---

### ℹ️ Info — `ShopAuthSocialController` Not in Intentionally Public Endpoints List

**File**: `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts`

The LINE/Facebook OAuth callback endpoints (`POST /shop/auth/line/callback`, `POST /shop/auth/facebook/callback`) are intentionally public (OAuth flows require no prior JWT). However, they are not listed in `security.md` under "Intentionally Public Endpoints". Once the bind-phone OTP issue is fixed, add the social auth callbacks to the public endpoints list so future reviewers don't flag them.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards` on all new controllers | ❌ `ShopAuthSocialController`, `ShopReservationController`, `ShopTrackingController` missing guards (undocumented) |
| `@Roles()` on controller methods | ✅ N/A — shop endpoints use session-based auth, not role guards |
| `deletedAt: null` in new queries | ✅ Present in `shop-auth-social.service.ts` and `shop-catalog.service.ts` |
| `Number()` on money fields | ❌ `shop-catalog.service.ts` — `Number(costPrice)` |
| Hardcoded secrets / API keys | ✅ None — all credentials via `process.env.*` |
| Unparameterized `$queryRaw` | ✅ None |
| OTP / authentication enforcement | ❌ `bind-phone` has no OTP verification |
| JWT audience claim | ❌ Shop tokens lack `aud: 'shop'` |
| CORS origins | ✅ `shop.bestchoicephone.app` + `localhost:5174` added correctly |

---

## Recommendation

**🚫 BLOCK** — two Critical issues must be resolved:

1. **`bind-phone` OTP enforcement** — implement OTP check inside the endpoint or require a verified temp token; current code allows account takeover by phone number.
2. **`Number()` on money fields** — replace with `Prisma.Decimal` arithmetic in `shop-catalog.service.ts`.

After fixing Criticals, also address the Warnings (ShopBotDefenseGuard on reservation/tracking, `aud: 'shop'` in JWT, `security.md` documentation) before re-review.
