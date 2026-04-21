# Merge Guard Report — feat/shop-phase1-foundation
**Date**: 2026-04-21  
**Branch**: `feat/shop-phase1-foundation`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Recommendation**: 🔴 **BLOCK**

---

## File Changes Summary

63 files changed, 46137 insertions(+), 16753 deletions(-) *(package-lock.json accounts for ~60k lines)*

| Area | Files |
|------|-------|
| New app | `apps/web-shop/` — Vite SPA (React 18, Tailwind) for customer-facing shop |
| Backend (new modules) | `shop-catalog`, `shop-auth-social`, `shop-reservation`, `shop-tracking`, `shop-bot-defense`, `shop-line-chat` |
| Backend (modified) | `app.module.ts` (import 6 new modules), CORS config (add shop subdomain) |
| Schema | `apps/api/prisma/schema.prisma` (new `KnownDevice` model, `facebookUserId` on Customer) |

---

## Feature Overview

Phase 1 of the customer-facing online shop: product catalog, social login (LINE OAuth + Facebook SDK), 15-minute product reservation, page-view tracking, bot defense guard, and contact form → LINE OA. New `apps/web-shop` Vite SPA on port 5174.

---

## Issues by Severity

### Critical

**[CRITICAL-1] `POST /shop/auth/bind-phone` has no OTP verification — account takeover vector**

File: `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts`

```ts
@Post('bind-phone')
async bindPhone(@Body() dto: BindPhoneDto) {
  return this.authService.bindPhoneToSocial(dto); // no OTP check in controller or service
}
```

Service comment: `// Note: assumes phone OTP already verified by caller` — but no OTP verification exists anywhere in the call chain (controller → service → DB). The endpoint accepts `{ phone, provider, providerUserId }` and binds any LINE/Facebook account to any customer matched by phone number.

**Attack scenario**: Attacker knows victim's phone number (publicly available). Attacker calls `POST /shop/auth/bind-phone` with victim's phone + attacker's own LINE/Facebook user ID. Attacker now has full login access to victim's BESTCHOICE account, can view contract details, payment history, and personal data.

**Fix required**: Implement OTP verification before bind-phone can complete. Either:
1. Require a valid short-lived OTP token (issued after SMS/LINE OTP verification) in the request, or
2. Create a separate 2-step endpoint: `/shop/auth/request-phone-otp` → `/shop/auth/verify-phone-otp` → then bind.

The endpoint **must not be merged** until OTP verification is wired in.

---

**[CRITICAL-2] `ShopReservationController` has no authentication — unauthenticated reservation manipulation**

File: `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts`

```ts
@Controller('shop/reservations')
export class ShopReservationController {
  @Post()
  async create(@Body() dto: CreateReservationDto) { ... }

  @Delete(':id')
  async cancel(@Param('id') id: string, @Body('sessionId') sessionId: string) { ... }
}
```

No `@UseGuards()` at class or method level. Anyone can create reservations (locking stock for 15 minutes) or cancel existing reservations by guessing/brute-forcing a `sessionId`. This enables:
- Inventory denial-of-service: flood with fake reservations to lock all stock
- Cancelling legitimate reservations of other users

The controller is not in the intentionally-public allowlist in `security.md` (chatbot-finance-liff, sms-webhook, paysolutions, address, health).

**Fix required**: Add either:
1. `@UseGuards(ShopJwtGuard)` (shop customer JWT) for authenticated shop users, or
2. Rate limiting + sessionId validation (if reservations must be anonymous) AND document as intentionally public in `security.md`.

---

**[CRITICAL-3] `Number()` on Decimal money fields in ShopCatalogService**

File: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`

```ts
const minPrice = Number(g._min?.costPrice ?? 0);  // costPrice is Decimal
const price = Number(u.costPrice);                  // costPrice is Decimal
```

`costPrice` is `@db.Decimal(12, 2)` in the schema. Converting with `Number()` causes floating-point precision loss (e.g., `19999.99` → `19999.999999999998`). Violates project rule: **"ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน"**.

**Fix required**: Use `new Prisma.Decimal(g._min?.costPrice ?? 0)` and return as string or call `.toDecimalPlaces(2).toNumber()` consistently at the serialization boundary (not mid-computation).

---

### Warning

**[WARN-1] `apps/web-shop/tailwind.config.ts` uses hardcoded HSL colors, not CSS variable tokens**

```ts
colors: {
  primary: { DEFAULT: 'hsl(160 84% 39%)', foreground: 'hsl(0 0% 100%)' },
  background: 'hsl(0 0% 100%)',
  foreground: 'hsl(240 10% 3.9%)',
  ...
}
```

Project rule: **"ห้ามใช้ hardcoded hex/gray colors, ใช้ CSS variable tokens เท่านั้น"**. While this is a separate app (`apps/web-shop`), maintaining consistent token usage prevents design drift. Should define CSS variables in `index.css` and reference via `var(--color-*)`.

---

**[WARN-2] `ShopTrackingController` is fully public with no documentation**

File: `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts`

The tracking controller (no guards) is intentional for anonymous page-view analytics but is not documented as intentionally public in `security.md`. Per security rules, any unguarded controller not on the allowlist is a security bug. Add to allowlist or add a comment referencing the policy.

---

**[WARN-3] `ProductDetailPage` is a stub — should not be in a mergeable branch**

File: `apps/web-shop/src/pages/ProductDetailPage.tsx`

```ts
export default function ProductDetailPage() { return <div>ProductDetailPage (stub)</div>; }
```

A routing stub returning a bare div is acceptable as a placeholder only if the route is not linked to from the homepage. The `CatalogPage` likely links to product detail pages. Merging stubs that are reachable in production creates a broken user experience.

---

**[WARN-4] `apps/web-shop` not wired into CI/CD**

No changes to `.github/workflows/deploy.yml` for the new `apps/web-shop` workspace. The shop app will not be built, type-checked, or deployed by CI after merge. This should be intentional (phased rollout) and documented, or CI should be updated.

---

### Info

**[INFO-1] `exchangeFacebookToken` sends access token in URL query param**  
File: `shop-auth-social.controller.ts`  
`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`  
Access token is in the URL and will appear in server logs. This is the documented FB Graph API pattern, but consider using the `Authorization: Bearer` header instead to avoid token leakage in logs.

**[INFO-2] `apps/web-shop/src/pages/HomePage.tsx` calls `/api/shop/products` via `api.get()` — correct pattern**  
No raw `fetch()` usage in the frontend shop app. ✅

**[INFO-3] Massive package-lock.json diff (60k lines) expected for new workspace**  
Legitimate — new Vite workspace adds dependencies. No unexpected packages visible in the diff.

**[INFO-4] CORS allows `https://shop.bestchoicephone.app` — requires DNS+cert setup before production**  
The CORS allowlist update is correct but implies infrastructure provisioning (new subdomain + TLS cert) must happen before the shop app goes live.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards` on all new controllers | ❌ ShopReservationController and ShopTrackingController missing guards |
| `@Roles()` on new endpoints | ❌ Not applicable (shop/customer JWT, not staff roles) — but shop auth controller needs guard |
| `deletedAt: null` in queries | ✅ ShopAuthSocialService correctly filters `deletedAt: null` |
| `Number()` on money fields | ❌ `Number(g._min?.costPrice)` and `Number(u.costPrice)` in ShopCatalogService |
| Hardcoded secrets | ✅ Uses env vars (`process.env.LINE_LOGIN_CHANNEL_ID`, etc.) |
| SQL injection | ✅ Not found |
| OTP/Auth before account binding | ❌ `bind-phone` endpoint has no OTP gate |

---

## Summary

Three critical issues block merge:

1. **Account takeover via bind-phone** — `POST /shop/auth/bind-phone` has no OTP verification, allowing any caller who knows a customer's phone number to take over their account.
2. **Unauthenticated reservation manipulation** — `ShopReservationController` has no guards, enabling inventory DoS and reservation cancellation attacks.
3. **Decimal precision loss** — `Number(costPrice)` in the catalog service converts monetary Decimal fields to JavaScript floats.

All three must be resolved before this branch can merge. Items WARN-1 through WARN-4 should also be addressed but do not block merge by themselves.
