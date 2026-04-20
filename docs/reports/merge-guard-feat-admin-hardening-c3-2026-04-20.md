# Merge Guard Report — feat/admin-hardening-c3

**Date**: 2026-04-20
**Branch**: `feat/admin-hardening-c3`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Compared against**: `origin/main`

---

## File Changes Summary

| Area | Files | +/- |
|------|-------|-----|
| `app.module.ts` | 1 | +14 |
| `AdminPrefixMiddleware` + spec | 2 | +77 |
| `auth.module.ts` | 1 | +4 |
| `auth.service.ts` (aud/scope claims) | 1 | +8 |
| `JwtAudienceGuard` + spec | 2 | +265 |
| `apps/web/src/lib/env.ts` | 1 | +9 |
| **Total** | **8** | **+373 / -4** |

---

## Issues

### Critical (0)

None found.

### Warning (0)

None found.

### Info (2)

**I1 — `AdminPrefixMiddleware` strips `/admin` before `RequestIdMiddleware`**
- The middleware order in `app.module.ts` is: `AdminPrefixMiddleware` → `RequestIdMiddleware` → `SecurityMiddleware`. This is intentional (documented in a comment) so that the rewritten URL is visible to all downstream middleware and Sentry tagging. The ordering is correct.

**I2 — `JwtAudienceGuard` is registered globally as `APP_GUARD`**
- The guard correctly defers when `req.user` is not set (unauthenticated/public paths), allowing existing public endpoints (chatbot-finance-liff, paysolutions, etc.) to remain unaffected. The guard spec covers 135 lines including edge cases. Implementation looks sound.

---

## Recommendation

**APPROVE** ✅

Clean security hardening. No issues. The JWT audience separation between admin-app tokens (`aud: 'admin'`) and shop/customer tokens (`aud: 'shop'`) correctly establishes the boundary needed by the upcoming shop phase.
