# Pre-Merge Guard Report — 2026-04-20

**Agent**: Pre-Merge Guard  
**Date**: 2026-04-20  
**Branches reviewed**: 3 most recent unmerged feature branches

---

## Summary

| Branch | Files Changed | Critical | Warning | Info | Recommendation |
|--------|--------------|----------|---------|------|----------------|
| `feat/customer-tier-phase1` | 17 (+2021/-7) | 0 | 2 | 2 | ⚠️ REVIEW |
| `feat/admin-hardening-c1` | 11 (+673/-7) | 0 | 0 | 1 | ✅ APPROVE |
| `feat/admin-hardening-c2` | 23 (+2057/-126) | 1 | 1 | 1 | 🚫 BLOCK |
| `feat/admin-hardening-c3` | 8 (+373/-4) | 0 | 1 | 1 | ⚠️ REVIEW |

> **Note**: These branches are stacked (c2 builds on c1, c3 builds on c2). Only unique changes per branch are analyzed.

---

## Branch 1: `feat/customer-tier-phase1`

**Authors**: iamnaii, Akenarin Kongdach  
**Latest commit**: `379159ee` feat(intake): auto-detect bank name from statement OCR (#622)

### File Changes Summary
- `apps/api/src/modules/customers/customer-tier.service.ts` (new, 199 lines)
- `apps/api/src/modules/customers/dto/tier.dto.ts` (new, 24 lines)
- `apps/api/src/modules/customers/customers.service.ts` (+21 lines — tier compute + filter)
- `apps/api/src/modules/customers/customers.controller.ts` (+12 lines — new `GET :id/tier` endpoint)
- `apps/web/src/components/customer/CustomerTierBadge.tsx` (new, 45 lines)
- `apps/web/src/pages/CustomersPage.tsx` (+32 lines — tier column + filter)
- `apps/web/src/pages/CustomerDetailPage.tsx` (+14 lines — tier badge on detail)
- `apps/web/src/types/customer-tier.ts` (new, 32 lines)
- 2 test files, 1 E2E spec, 2 plan/design docs

### Issues

#### ⚠️ Warning

**W1 — Pagination broken when tier filter is active** (`apps/api/src/modules/customers/customers.service.ts:141-164`)

The tier filter is applied in-memory after the DB query. The `total` count returned to the frontend is the count of all customers **before** tier filtering. When a user selects "GOLD" tier filter, the UI may display "Showing 20 of 156 results" when the true total for GOLD tier could be 8 customers — pagination controls will be incorrect.

```typescript
// Line ~155 — filter applied after DB paginate
const filtered = tier ? withTier.filter((c) => c.tier === tier) : withTier;
return { ...paginatedResponse(filtered, total, page, limit), summary };
//                                              ^^^^^ wrong: total is pre-filter count
```

**Fix**: Either store tier on the `Customer` model (indexed, query-time filter) or return `filtered.length` as the total when a tier filter is active.

**W2 — `toNumber()` on money field passed to interface** (`apps/api/src/modules/customers/customer-tier.service.ts:160,167`)

```typescript
currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber(),
```

`currentOutstanding` is `Prisma.Decimal` — the project rule prohibits converting financial values to JS `number` (floating-point precision risk). Although this value is used for display only in the response, the field is typed as `number` in `TierInputHistory` and could be reused in arithmetic later. Should stay as `Decimal` or `string`.

#### ℹ️ Info

**I1 — N+1 query pattern on customer list** (`customers.service.ts:141`)

`Promise.all()` fires `getCustomerTier(c.id)` for each customer on every page load (up to 50 queries per request). The code comment acknowledges this with "valid for small shops." Acceptable for now but should be tracked as technical debt before shop scale-up.

**I2 — Large plan document committed to source** (`plans/2026-04-20-customer-tier-phase1.md`, 1132 lines)

Planning documents don't belong in the source tree; they bloat the repo and get stale. Consider moving to GitHub wiki or a separate docs/ location.

### Recommendation: ⚠️ REVIEW

No blockers. Fix W1 (pagination bug) before merge — incorrect pagination count is a visible UX defect. W2 is minor but should be addressed to stay consistent with project rules.

---

## Branch 2: `feat/admin-hardening-c1`

**Authors**: iamnaii, Akenarin Kongdach  
**Base**: `origin/main`

### File Changes Summary
- `apps/api/src/utils/device-fingerprint.util.ts` (new, 182 lines)
- `apps/api/src/utils/device-fingerprint.util.spec.ts` (new, 126 lines)
- `apps/api/src/modules/auth/login-audit.service.ts` (+56 lines — new device detection)
- `apps/api/src/modules/auth/login-audit.service.spec.ts` (updated)
- `apps/api/src/modules/auth/auth.service.ts` (+8 lines)
- `apps/api/src/modules/auth/auth.controller.ts` (updated)
- `apps/api/src/modules/auth/auth.module.ts` (updated)
- `apps/web/index.html` (+1 line)
- `apps/web/public/robots.txt` (new, 47 lines)

### Issues

#### ℹ️ Info

**I1 — New `robots.txt` allows all paths under `/`**

`robots.txt` is added with `Disallow:` rules. Verify the disallow directives cover the admin panel path (`/api/admin/`) and sensitive routes if required for SEO/security posture.

### Recommendation: ✅ APPROVE

Clean implementation. Device fingerprinting logic is pure (no financial fields), guards on auth controller are unchanged, new device LINE alert uses existing `lineOaService`. No critical or warning issues.

---

## Branch 3: `feat/admin-hardening-c2`

**Authors**: iamnaii, Akenarin Kongdach  
**Unique changes on top of c1**: 2FA system, social login (LINE/Facebook), bot defense

### File Changes Summary (unique vs c1)
- `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` (new, 67 lines)
- `apps/api/src/modules/shop-auth-social/shop-auth-social.service.ts` (new)
- `apps/api/src/modules/shop-auth-social/dto/social-login.dto.ts` (new, 22 lines)
- `apps/api/src/modules/shop-bot-defense/shop-bot-defense.guard.ts` (new)
- `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.ts` (new, 127 lines)
- `apps/api/src/modules/auth/two-factor.service.ts` (new)
- `apps/api/src/modules/auth/auth.service.ts` (updated)
- `apps/web/src/pages/SetupTwoFactorPage.tsx` (new, 283 lines)
- `apps/web/src/pages/LoginPage.tsx` (+107 lines — 2FA step)
- `apps/web/src/contexts/AuthContext.tsx` (+107 lines)
- `apps/api/src/main.ts` (updated)
- `apps/api/src/app.module.ts` (updated)

### Issues

#### 🚫 Critical

**C1 — `ShopAuthSocialController` has no authentication guard on `bind-phone` endpoint** (`apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts`)

The entire controller has **no `@UseGuards()`** at class or method level. While `line/callback` and `facebook/callback` are intentionally public OAuth exchange endpoints, `POST /api/shop/auth/bind-phone` is **not** guarded and binds an arbitrary phone number to an arbitrary social provider identity:

```typescript
@Controller('shop/auth')
// ← NO @UseGuards here
export class ShopAuthSocialController {

  @Post('bind-phone')  // ← No guard — anyone can call this
  async bindPhone(@Body() dto: BindPhoneDto) {
    return this.authService.bindPhoneToSocial(dto);
  }
```

An unauthenticated attacker can POST `{ phone: "0812345678", provider: "LINE", providerUserId: "any_id" }` and hijack or corrupt any customer's phone binding. This endpoint must require a short-lived session token issued during the OAuth callback flow (e.g., a temp JWT with `aud='shop_oauth'`).

**This controller is also not listed in the project's documented intentionally-public endpoints** (security.md: chatbot-finance-liff, sms-webhook, paysolutions, address, health).

#### ⚠️ Warning

**W1 — `BindPhoneDto` missing phone format validation** (`dto/social-login.dto.ts:10`)

```typescript
export class BindPhoneDto {
  @IsString()       // ← Only IsString, no format check
  phone!: string;
```

Missing `@IsNotEmpty()` and `@Matches(/^0[0-9]{9}$/)` (or similar Thai mobile pattern). An empty string or malformed phone would pass validation.

#### ℹ️ Info

**I1 — Bot defense `CATALOG_RATE_LIMIT_PER_MIN = 30` is defined but not wired**

`shop-bot-defense.service.ts` defines `CATALOG_RATE_LIMIT_PER_MIN` but the `decideAction()` method only uses `RATE_LIMIT_PER_MIN`. The catalog-specific limit appears unused.

### Recommendation: 🚫 BLOCK

C1 is a security vulnerability: unauthenticated phone binding on a customer-facing endpoint. Must be fixed before merge. Fix: require a short-lived OAuth session token on `bind-phone`, or at minimum add an OTP verification step.

---

## Branch 4: `feat/admin-hardening-c3`

**Authors**: iamnaii, Akenarin Kongdach  
**Unique changes on top of c2**: JwtAudienceGuard, TwoFactorModule wiring, AdminPrefixMiddleware

### File Changes Summary (unique vs c2)
- `apps/api/src/modules/auth/guards/jwt-audience.guard.ts` (new, 130 lines)
- `apps/api/src/modules/auth/guards/jwt-audience.guard.spec.ts` (new, 135 lines)
- `apps/api/src/modules/auth/auth.service.ts` (+8 lines)
- `apps/web/src/lib/env.ts` (+9 lines)
- `apps/api/src/app.module.ts` (TwoFactorModule + JwtAudienceGuard as APP_GUARD)

### Issues

#### ⚠️ Warning

**W1 — `/api/auth/` public path bypass is overly broad in `JwtAudienceGuard`** (`jwt-audience.guard.ts:35`)

```typescript
const PUBLIC_PATHS = [
  ...
  /^\/api\/auth\//,    // ← All of /api/auth/* bypasses audience check
];
```

Any future endpoint added under `/api/auth/` (e.g., `/api/auth/sessions`, `/api/auth/devices/revoke`) would silently bypass JWT audience enforcement. Consider narrowing to specific public paths: `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/forgot-password`, `/api/auth/reset-password`.

#### ℹ️ Info

**I1 — `shop/auth` OAuth paths fall under `SHOP_PATH` regex but are unauthenticated**

`ShopAuthSocialController` serves `/api/shop/auth/*`. The `SHOP_PATH = /^\/api\/shop\//` regex would match these, requiring `aud='shop'`. However, since unauthenticated requests have no `req.user`, the guard correctly defers (`if (!req.user) return true`). This works correctly in practice, but worth a comment to make the intent clear.

### Recommendation: ⚠️ REVIEW

Dependent on c2 being fixed (C1). Once c2 is fixed, c3 only needs W1 addressed (narrow the `/api/auth/` bypass). The JwtAudienceGuard implementation is otherwise solid — good coverage of path-based rules, decorator override mode, and 2FA temp token paths.

---

## Action Items Before Merge

| Priority | Branch | Action |
|----------|--------|--------|
| 🚫 **Must fix** | `admin-hardening-c2` | Add session token guard on `POST /shop/auth/bind-phone` |
| ⚠️ **Should fix** | `customer-tier-phase1` | Fix pagination `total` count when tier filter active |
| ⚠️ **Should fix** | `customer-tier-phase1` | Change `currentOutstanding` from `number` to `Decimal`/`string` |
| ⚠️ **Should fix** | `admin-hardening-c2` | Add `@IsNotEmpty()` + phone pattern to `BindPhoneDto` |
| ⚠️ **Should fix** | `admin-hardening-c3` | Narrow `/api/auth/` bypass to specific paths |
| ℹ️ **Track** | `customer-tier-phase1` | N+1 tier queries — schedule as tech debt before scale |

---

*Generated by Pre-Merge Guard — BESTCHOICE WAT Framework*
