# Merge Guard Report — feat/admin-hardening-c3

**Date**: 2026-04-22  
**Branch**: `feat/admin-hardening-c3`  
**Base**: `origin/main`  
**Commits unique to branch**: 4 (38f3ba4e…e7be1590 + merge)  
**Files changed**: 8 files (+373 lines, −4 lines)  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| API — middleware | `admin-prefix.middleware.ts` (+32), `admin-prefix.middleware.spec.ts` (+45) | Strips `/admin` from `/api/admin/*` URLs |
| API — guard | `jwt-audience.guard.ts` (+130), `jwt-audience.guard.spec.ts` (+135) | Enforces JWT `aud` claim by path prefix |
| API — auth | `auth.service.ts` (+8) | Adds `aud: 'admin'` + `scope: 'admin:full'` to all admin JWTs |
| API — wiring | `app.module.ts` (+14), `auth.module.ts` (+4) | Registers middleware + guard globally |
| Frontend | `apps/web/src/lib/env.ts` (+5, −1) | Admin app base URL → `/api/admin` |

---

## Issues by Severity

### CRITICAL — None found

No missing guards, no money precision issues, no hard-coded secrets. The `JwtAudienceGuard` correctly defers to `JwtAuthGuard` when `req.user` is absent, preventing bypass of authentication. Public paths (sms-webhook, paysolutions, LIFF, address, health, auth) are correctly excluded from audience enforcement.

---

### WARNING — Should fix

#### W-1: Breaking change for existing sessions — old JWTs lack `aud` claim

`auth.service.ts` now adds `aud: 'admin'` to newly-issued JWTs. However, **all currently active sessions hold tokens issued before this change** — those tokens have no `aud` claim.

When `JwtAudienceGuard` runs on an authenticated request with an old token:

```ts
// jwt-audience.guard.ts ~111
if (path.startsWith('/api/')) {
  if (aud !== 'admin') {  // undefined !== 'admin' → TRUE
    throw new ForbiddenException('Admin endpoint requires admin audience');
  }
}
```

Every logged-in user with an existing session will receive `403 Forbidden` on ALL requests immediately after this deployment — even if their refresh token is still valid (the refreshed access token will include `aud`, but only after an explicit refresh round-trip).

**Required action before merge**:
1. Document in the deployment runbook that all active sessions will be interrupted once on first request post-deploy.
2. Alternatively, issue a one-time forced token refresh: return a `401` with a hint header so the axios interceptor in `api.ts` triggers a refresh cycle automatically. (The current axios interceptor already handles 401 → refresh, so users may be silently recovered on the next request without a login prompt — verify this behaviour end-to-end before shipping.)

#### W-2: `JwtAudienceGuard` must run strictly after `JwtAuthGuard` — ordering is implicit

The guard depends on `req.user` being populated by `JwtAuthGuard`:

```ts
if (!req.user) return true; // no user → let JwtAuthGuard handle it
const aud = req.user.aud as string | undefined;
```

`APP_GUARD` providers in NestJS execute in **registration order**. The current `app.module.ts` order is: `ThrottlerGuard` → `CsrfGuard` → `JwtAudienceGuard`. `JwtAuthGuard` is **per-controller** (not an `APP_GUARD`), meaning it runs when a controller method is actually matched — which is **after** all global guards.

In practice this means `JwtAudienceGuard` runs **before** `JwtAuthGuard` sets `req.user`, so `req.user` will always be `undefined` at the time `JwtAudienceGuard` runs. The guard's `if (!req.user) return true` branch means audience enforcement is **never actually applied** for the current guard execution model.

**This is a latent bug** — the feature appears to work in tests (which mock `req.user`), but in production the guard will always take the `return true` early-exit path.

**Fix options**:
- Register `JwtAuthGuard` as a global `APP_GUARD` (before `JwtAudienceGuard`), so `req.user` is set for all routes.
- Or combine audience validation into the `JwtStrategy.validate()` method / a Passport guard that runs as part of the same passport pipeline.
- Or use a NestJS `ExecutionContext`-based JWT decode (call `jwtService.verify` inside `JwtAudienceGuard` directly), removing the dependency on `req.user`.

---

### INFO

#### I-1: `AdminPrefixMiddleware` does not test path-traversal or encoded-slash inputs

`admin-prefix.middleware.spec.ts` tests happy-path rewrites. Edge cases like `/api/admin/../secrets`, `/api/admin%2F../bypass`, or `/api/adminHEY` are not tested.

The current implementation uses `req.url.startsWith('/api/admin/')` which is safe against those specific cases (the encoded slash and traversal would not match), but an explicit test would document this intent.

#### I-2: `env.ts` change silently affects non-admin environments

`resolveApiUrl()` now returns `/api/admin` in **all non-localhost production environments**, not just when the app is served from `admin.bestchoicephone.app`. If the same `apps/web` build is served from multiple origins (e.g., a staging environment without the `AdminPrefixMiddleware` backend), API calls will 404.

Consider gating on `import.meta.env.VITE_ADMIN_APP=true` or the hostname check (`window.location.hostname === 'admin.bestchoicephone.app'`) rather than making `/api/admin` the unconditional default.

---

## Recommendation: **REVIEW**

The architecture is sound — `AdminPrefixMiddleware` + JWT audience claims is a clean way to separate admin and shop JWT namespaces. The `JwtAudienceGuard` tests are thorough.

Two issues require attention before merge:

1. **W-2 is a functional bug** — the guard never enforces audience in production due to the `req.user` ordering problem with per-controller `JwtAuthGuard`. Verify end-to-end that shop JWTs are actually blocked from admin endpoints before merge, or fix the guard ordering as described.

2. **W-1 (session interruption)** — is acceptable if the ops team is aware and the axios 401-refresh cycle handles the transition transparently. Verify this in staging before production deployment.

**Merge order dependency**: `feat/admin-hardening-c3` should merge **before** `feature/shop-phase2-cart-checkout`, since the audience guard secures the `/api/shop/*` endpoints introduced by the shop branch.
