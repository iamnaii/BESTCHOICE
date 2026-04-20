# Merge Guard Report — feat/admin-hardening-c3

**Date**: 2026-04-20  
**Branch**: `feat/admin-hardening-c3`  
**Author**: Akenarin Kongdach  
**Latest commit**: `e7be159` — Merge remote-tracking branch 'origin/main' into feat/admin-hardening-c3  
**Recommendation**: ⚠️ REVIEW — Confirm deployment plan before merge

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/src/app.module.ts` | Register `AdminPrefixMiddleware` + `JwtAudienceGuard` as global APP_GUARD | +12 |
| `apps/api/src/modules/auth/auth.module.ts` | Export `JwtAudienceGuard` | +4 |
| `apps/api/src/modules/auth/auth.service.ts` | Add `aud: 'admin'`, `scope: 'admin:full'` to all JWT payloads | +8 |
| `apps/api/src/modules/auth/guards/jwt-audience.guard.ts` | New guard — path-based + decorator audience enforcement | +130 |
| `apps/api/src/modules/auth/guards/jwt-audience.guard.spec.ts` | 15 unit tests | +135 |
| `apps/api/src/common/middleware/admin-prefix.middleware.ts` | Strips `/api/admin/` → `/api/` from incoming requests | +32 |
| `apps/api/src/common/middleware/admin-prefix.middleware.spec.ts` | 4 unit tests | +45 |
| `apps/web/src/lib/env.ts` | Default API base URL changed from `/api` to `/api/admin` | +9/-4 |

---

## Issues by Severity

### ⚠️ Warning (should fix / plan for)

**W-001 — Session invalidation on deploy (breaking change for live sessions)**  
All existing JWTs in circulation were issued without the `aud` claim. After deploy, `JwtAudienceGuard` will check `req.user.aud !== 'admin'` for standard `/api/*` paths. Existing tokens have `aud === undefined`, which fails the check and throws `ForbiddenException`.

This means **all currently logged-in users will receive 403 errors** until their tokens expire and they re-login (or the refresh token flow issues a new token with `aud`).

Check the refresh flow: if `refreshToken()` in `auth.service.ts` reissues a new access token with `aud: 'admin'` (it does — line 435 was patched), then any user who hits a 403 and triggers a token refresh will be seamlessly upgraded. The axios interceptor in `api.ts` auto-refreshes on 401, but a 403 ForbiddenException is **not a 401** and will not trigger auto-refresh.

**Fix options**:
1. In `JwtAudienceGuard`, when `aud` is missing/undefined on a non-shop path, treat it as `'admin'` (backwards compatibility mode) and log a warning via Sentry. Remove the compatibility mode after 1 release cycle.
2. Proactively logout all users before deploying (acceptable for a planned hardening sprint).
3. Change the guard to return `true` for `aud === undefined` (aud-unaware tokens) on admin paths, and only enforce for tokens that explicitly carry a wrong audience.

**W-002 — Misleading test description at jwt-audience.guard.spec.ts line 43**  
```ts
it('throws ForbiddenException when JWT has no aud claim but decorator requires one', () => {
  const { guard, context } = makeContext({ path: '/api/customers', aud: undefined, decoratorAud: 'admin' });
  // req.user is undefined → guard defers to JwtAuthGuard → returns true
  expect(guard.canActivate(context)).toBe(true);
});
```
The test title says "throws ForbiddenException" but the test body expects `true`. The comment explains it (req.user is undefined → defer), but the name is wrong and will confuse future readers.  
**Fix**: Rename to `'defers to JwtAuthGuard when req.user is undefined even with @RequireAudience decorator'`.

---

### ℹ️ Info

**I-001 — `req.url` mutation in AdminPrefixMiddleware**  
Mutating `req.url` in Express middleware is an established pattern (it's how NestJS's global prefix works), but worth noting that any middleware that logs `req.url` before `AdminPrefixMiddleware` runs will see the original `/api/admin/...` URL. The middleware is registered first (`consumer.apply(AdminPrefixMiddleware).forRoutes('*')` before `RequestIdMiddleware`), so structured logging will see the rewritten URL. ✅ OK as-is.

**I-002 — `scope: 'admin:full'` claim added but not enforced anywhere**  
The `scope: 'admin:full'` claim is added to the JWT payload but `JwtAudienceGuard` never reads `scope`. It will sit unused. This is fine as a forward-looking placeholder, but if it's not used for fine-grained access control it's dead weight.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New middleware does not bypass auth | ✅ Strips URL prefix only — does not alter `req.user` or auth headers |
| `JwtAudienceGuard` public paths include all known public endpoints | ✅ chatbot-finance-liff, sms-webhook, paysolutions, address, health, auth all in `PUBLIC_PATHS` |
| Shop paths correctly require `aud='shop'` | ✅ `/api/shop/*` path rule enforces `aud='shop'` |
| 2FA temp tokens handled | ✅ `TEMP_TOKEN_PATHS` accepts `2fa_setup` and `2fa_login` audiences |
| No hardcoded secrets | ✅ |
| Guards test coverage | ✅ 15 tests covering all path patterns + decorator mode |

---

## Recommendation

**⚠️ REVIEW** — The implementation is correct and well-designed. The primary concern is the **live session invalidation** (W-001). Confirm the deployment plan:
- If deploying during off-hours with acceptable forced re-login, **merge is safe**.
- If zero-disruption is required, implement the backwards-compatibility mode first.

Rename the misleading test (W-002) before merge.
