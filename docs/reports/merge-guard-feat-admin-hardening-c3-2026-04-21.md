# Merge Guard Report — feat/admin-hardening-c3

**Date**: 2026-04-21  
**Branch**: `feat/admin-hardening-c3`  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ APPROVE (with coordination note — see Info items)

---

## File Changes Summary

8 files changed, 373 insertions, 4 deletions

| Area | Files |
|------|-------|
| API — new middleware | `common/middleware/admin-prefix.middleware.ts` (32 lines) + spec (45 lines) |
| API — new guard | `modules/auth/guards/jwt-audience.guard.ts` (130 lines) + spec (135 lines) |
| API — modified | `app.module.ts`, `auth.module.ts`, `auth.service.ts` |
| Web — modified | `lib/env.ts` |

---

## What This Does

- **`AdminPrefixMiddleware`**: Strips `/admin` from `/api/admin/*` request URLs so existing controllers at `/api/*` handle them transparently. Runs first in the middleware chain.
- **`JwtAudienceGuard`**: Global APP_GUARD that enforces the `aud` JWT claim. Two modes: (1) `@RequireAudience('X')` decorator override; (2) path-based auto-detection (`/api/shop/*` → `aud='shop'`, all other `/api/*` → `aud='admin'`, public paths exempt).
- **`auth.service.ts`**: All admin JWTs now carry `aud: 'admin'` and `scope: 'admin:full'`.
- **`env.ts`**: Frontend admin app API base URL changed from `/api` to `/api/admin`.

---

## Issues

### ℹ️ Info — Cross-Branch Dependency: Shop JWTs Lack `aud: 'shop'` Claim

**Affected by**: `feat/shop-phase1-foundation` (if merged to main before or alongside this branch)

`JwtAudienceGuard` requires `aud === 'shop'` for all `/api/shop/*` requests (path-based mode). However, `ShopAuthSocialService.signToken()` in `feat/shop-phase1-foundation` issues tokens with only `{ sub: customerId, role: 'CUSTOMER' }` — no `aud` claim.

**Effect**: If both branches merge, shop customers who authenticate via LINE/Facebook OAuth will receive tokens without `aud: 'shop'`, and all their subsequent requests to `/api/shop/*` will get `403 ForbiddenException`.

**Required action before merging `feat/shop-phase1-foundation`**: Update `ShopAuthSocialService.signToken()` to include `aud: 'shop'`.

---

### ℹ️ Info — LIFF / Customer Tokens May Lack `aud` Claim

Any existing `CustomerAccessToken` or LIFF-issued tokens that don't carry an `aud` claim will fail on future endpoints that use `@RequireAudience`. Review all token issuers before enabling decorator mode broadly.

The path-based guard correctly defers on `req.user === undefined` (lets `JwtAuthGuard` handle the 401), so unauthenticated requests are safe. This only affects tokens that exist but lack the expected `aud`.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controller introduced | ✅ None — only middleware + guard |
| `@UseGuards` on new endpoints | ✅ N/A — guard is registered globally via APP_GUARD |
| `Number()` on financial fields | ✅ None |
| `deletedAt: null` in new queries | ✅ N/A — no new queries |
| Hardcoded secrets / API keys | ✅ None |
| Unparameterized `$queryRaw` | ✅ None |
| Public endpoints still accessible | ✅ Path-based allowlist correctly covers `auth/`, `health`, `address/`, `paysolutions`, `sms-webhook`, `chatbot-finance-liff/` |
| Test coverage | ✅ 45 middleware tests + 135 guard tests |

---

## Recommendation

**✅ APPROVE** — implementation is clean, well-tested, and properly documented. The only action required is coordinating the `aud: 'shop'` claim in `feat/shop-phase1-foundation` before that branch merges.
