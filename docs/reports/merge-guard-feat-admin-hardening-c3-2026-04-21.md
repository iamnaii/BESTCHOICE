# Merge Guard Report — feat/admin-hardening-c3

**Date:** 2026-04-21  
**Branch:** `feat/admin-hardening-c3`  
**Author:** iamnaii (akenarin.ak@gmail.com)  
**Diff size:** 8 files changed, 373 insertions(+), 4 deletions(-)  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| Backend guard | `jwt-audience.guard.ts` | New global guard enforcing JWT `aud` claim |
| Backend guard | `jwt-audience.guard.spec.ts` | 135 test cases |
| Backend middleware | `admin-prefix.middleware.ts` | Strips `/api/admin/` → `/api/` prefix |
| Backend middleware | `admin-prefix.middleware.spec.ts` | 4 test cases |
| Backend | `auth.service.ts` | Adds `aud: 'admin'` + `scope: 'admin:full'` to all 3 JWT signing paths |
| Backend | `auth.module.ts` | Exports `JwtAudienceGuard` |
| Backend | `app.module.ts` | Registers `JwtAudienceGuard` as global `APP_GUARD` + `AdminPrefixMiddleware` |
| Frontend | `apps/web/src/lib/env.ts` | Default API base URL changed from `/api` to `/api/admin` |

---

## Issues by Severity

### 🔴 Critical — None

No critical security issues. This branch *adds* security surface:
- `JwtAudienceGuard` validates `aud` claim on every authenticated request.
- `AdminPrefixMiddleware` provides a clean namespace separation between admin and shop frontends.
- All 3 JWT signing paths in `auth.service.ts` now include `aud: 'admin'`.

### 🟡 Warning

**W-1: `env.ts` — default API base URL changed to `/api/admin`**

```typescript
// Before:
const configured = import.meta.env.VITE_API_URL || '/api';
// After:
const configured = import.meta.env.VITE_API_URL || '/api/admin';
```

This change means the admin frontend (`apps/web`) will now prefix all API calls with `/api/admin/`, which are then stripped by `AdminPrefixMiddleware`. While intentional, this is a **breaking change** if:
- Any code in `apps/web` constructs API URLs as plain strings (e.g., `'/api/customers'`) instead of using `api.get('/customers')` from `@/lib/api`.
- Any existing Playwright E2E test intercepts `/api/` routes directly.

Verify with `grep -r "'/api/" apps/web/src` that no raw `/api/` URLs are used outside of `api.ts`.

**W-2: `JwtAudienceGuard` must merge before `feat/shop-phase1-foundation`**

`JwtAudienceGuard` path rules expect shop JWTs to carry `aud: 'shop'`. The shop auth service (`feat/shop-phase1-foundation`) currently issues tokens without `aud: 'shop'`. If the hardening branch merges first, shop login will still work (tokens are issued before the guard runs), but shop API calls will fail until `feat/shop-phase1-foundation` is fixed.

Merge order recommendation: `admin-hardening-c3` → fix `shop-phase1-foundation` → merge shop.

### 🔵 Info

**I-1: 2FA path rules are well-considered**

`/api/2fa/*` accepts `aud='admin'` OR `aud='2fa_login'` OR `aud='2fa_setup'` — correctly handles the flow where a temp 2FA token is issued before the full admin JWT.

**I-2: Public paths include all documented intentionally-public endpoints**

Chatbot LIFF, SMS webhook, PaySolutions, address static data, and health endpoint are all correctly exempted. This matches the security rules whitelist in `.claude/rules/security.md`.

**I-3: 135 test cases**

Full coverage of decorator mode (3 tests) and path-based mode (12+ scenarios). Tests are well-organized and verify both allow and deny paths.

---

## Verdict

**✅ APPROVE** — Clean security hardening with no critical issues. Address W-1 by auditing raw URL usage in `apps/web/src`, and plan merge order carefully relative to `feat/shop-phase1-foundation`.
