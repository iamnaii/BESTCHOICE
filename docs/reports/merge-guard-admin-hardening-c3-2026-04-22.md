# Pre-Merge Guard Report — feat/admin-hardening-c3

**Date**: 2026-04-22  
**Branch**: `feat/admin-hardening-c3`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last commit**: 2026-04-20 17:15 +0700  
**Commits ahead of main**: 5  
**Recommendation**: ✅ **APPROVE** — no Critical or Warning issues

---

## File Changes Summary

8 files changed, 373 insertions(+), 4 deletions(-)

New files:
- `apps/api/src/common/middleware/admin-prefix.middleware.ts` — strips `/api/admin/*` → `/api/*`
- `apps/api/src/common/middleware/admin-prefix.middleware.spec.ts` — 4 unit tests
- `apps/api/src/modules/auth/guards/jwt-audience.guard.ts` — global `aud` claim enforcer
- `apps/api/src/modules/auth/guards/jwt-audience.guard.spec.ts` — 20 unit tests

Modified files:
- `apps/api/src/app.module.ts` — `AdminPrefixMiddleware` + `JwtAudienceGuard` as `APP_GUARD`
- `apps/api/src/modules/auth/auth.module.ts` — exports `JwtAudienceGuard`
- `apps/api/src/modules/auth/auth.service.ts` — adds `aud: 'admin'`, `scope: 'admin:full'` to all admin JWTs
- `apps/web/src/lib/env.ts` — admin web API base changes from `/api` to `/api/admin`

---

## Issues

### 🔴 Critical

None.

---

### ⚠️ Warning

None.

---

### ℹ️ Info

#### I-1: `env.ts` changes API base from `/api` to `/api/admin`
**File**: `apps/web/src/lib/env.ts`

```ts
const configured = import.meta.env.VITE_API_URL || '/api/admin';
// ...
return '/api/admin';
```

This is the intended change — the admin web app will now send requests to `/api/admin/*`, which `AdminPrefixMiddleware` strips server-side. All existing controller routes remain unchanged.

**Risk**: If any existing Vite proxy config or nginx config uses `/api` path matching in a way that excludes `/api/admin`, the proxy would need updating. Verify `vite.config.ts` and production nginx config cover `/api/admin/*`.

#### I-2: `JwtAudienceGuard` is a global `APP_GUARD` — execution order
**File**: `apps/api/src/app.module.ts`

The guard is registered after `CsrfGuard` in the providers array. The comment in the guard explains the dependency correctly: `JwtAudienceGuard` checks `req.user.aud`, which is set by `JwtAuthGuard` (per-controller) → if `req.user` is undefined, the audience guard defers and lets `JwtAuthGuard` handle the 401. This is a well-considered design.

#### I-3: `scope: 'admin:full'` claim — not enforced anywhere yet
**File**: `apps/api/src/modules/auth/auth.service.ts`

The `scope` claim is added to JWTs but no code currently checks it. This is forward-compatible scaffolding for future scope-based access control. No issue — just noting it is inert.

#### I-4: Shop auth token — audience correctly set to `'shop'`
**File**: `apps/api/src/modules/shop-auth-social/shop-auth-social.service.ts`

```ts
return this.jwt.signAsync(
  { sub: customerId, role: 'CUSTOMER' },
  { expiresIn: '7d', audience: 'shop' },
);
```

The shop customer token correctly uses `audience: 'shop'`, and `JwtStrategy.validate` correctly routes `aud === 'shop'` payloads to the Customer table. The audience separation is properly implemented end-to-end.

---

## Security Analysis

| Check | Result |
|-------|--------|
| New controllers have `JwtAuthGuard` | ✅ No new controllers added |
| `Number()` on money fields | ✅ None found |
| `deletedAt: null` on new queries | ✅ Present where applicable |
| Hardcoded secrets / API keys | ✅ None found |
| `$queryRaw` without parameters | ✅ None found |
| JWT audience claim added consistently | ✅ All 3 token-issue paths updated |
| Test coverage for new guard | ✅ 20 tests in `jwt-audience.guard.spec.ts` |
| Test coverage for new middleware | ✅ 4 tests in `admin-prefix.middleware.spec.ts` |

---

## Recommendation

**✅ APPROVE** — well-tested security hardening with no issues found.

The JWT audience separation (`aud: 'admin'` vs `aud: 'shop'`) is a meaningful security boundary that prevents shop/customer tokens from being used against admin endpoints and vice versa. The `AdminPrefixMiddleware` approach allows zero controller refactoring while enabling a separate `/api/admin/*` URL namespace for the admin app.

Before merge, verify that the Vite dev proxy and production nginx config are updated to route `/api/admin/*` → backend (I-1).
