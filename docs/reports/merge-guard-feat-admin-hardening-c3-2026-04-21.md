# Merge Guard Report — feat/admin-hardening-c3

**Date**: 2026-04-21
**Branch**: `feat/admin-hardening-c3`
**Author**: Akenarin Kongdach
**Last commit**: 2026-04-20 — `Merge remote-tracking branch 'origin/main' into feat/admin-hardening-c3`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/app.module.ts` | +14/-3 — register `AdminPrefixMiddleware` + `JwtAudienceGuard` as global |
| `apps/api/src/common/middleware/admin-prefix.middleware.ts` | +32 (new) |
| `apps/api/src/common/middleware/admin-prefix.middleware.spec.ts` | +45 (new, 4 tests) |
| `apps/api/src/modules/auth/auth.module.ts` | +4/-1 — export `JwtAudienceGuard` |
| `apps/api/src/modules/auth/auth.service.ts` | +8 — add `aud: 'admin'` + `scope: 'admin:full'` to JWT payloads |
| `apps/api/src/modules/auth/guards/jwt-audience.guard.ts` | +130 (new) |
| `apps/api/src/modules/auth/guards/jwt-audience.guard.spec.ts` | +135 (new, 19 tests) |
| `apps/web/src/lib/env.ts` | +5/-4 — change default API base from `/api` to `/api/admin` |

**8 files changed, 373 insertions(+), 4 deletions(-)**

---

## Issues by Severity

### Critical
_None found._

### Warning

**W-1 · `env.ts` change affects all environments including E2E/CI**
- File: `apps/web/src/lib/env.ts`
- The `resolveApiUrl()` default changes from `/api` to `/api/admin` in both dev and production.
- **Risk**: Any test environment, CI pipeline, or deployment that has `VITE_API_URL` unset will now route all frontend API calls through `/api/admin/*`. If `AdminPrefixMiddleware` is not present in that environment (e.g., a staging build before this branch is deployed), all calls will 404.
- **Mitigation needed**: Verify the middleware is deployed atomically with this frontend change. Consider whether a feature flag or environment variable is safer for the cutover.

**W-2 · Path-based audience enforcement is brittle**
- File: `apps/api/src/modules/auth/guards/jwt-audience.guard.ts`
- The guard relies on path patterns (`/api/shop/`, `/api/2fa/`, etc.) to determine required audience — no `@RequireAudience` decorator is used on existing controllers.
- **Risk**: If a new route is added that doesn't match the hard-coded patterns (e.g., `/api/shop-assistant/`), it will silently fall through to the default `aud='admin'` requirement without any compile-time signal.
- **Recommendation**: Use `@RequireAudience('admin')` explicitly on controller classes instead of relying on path inference. Or document the path convention clearly in `CLAUDE.md`.

### Info

**I-1 · Shop-audience JWT issuance not implemented**
- File: `apps/api/src/modules/auth/auth.service.ts`
- `aud: 'admin'` is added to all three JWT-issuing code paths (login, refresh, MFA). There is no corresponding `aud: 'shop'` issuance path.
- The `SHOP_PATH` pattern in `jwt-audience.guard.ts` (`/api/shop/`) is therefore dead code until a shop-customer authentication flow is added.
- Not a bug, but worth tracking: future `/api/shop/*` routes will need a separate token issuance path.

**I-2 · `auth.service.ts` has three near-identical JWT payload construction sites**
- Lines ~229, ~435, ~669 each add `aud` and `scope` independently.
- A helper function (e.g., `buildAdminPayload()`) would reduce duplication, but this is out of scope for a hardening PR.

---

## Recommendation: **APPROVE**

The PR introduces a well-designed JWT audience enforcement layer with solid test coverage (23 tests across guard + middleware). The `JwtAudienceGuard` correctly defers to `JwtAuthGuard` when `req.user` is unset, and the public-path allow-list matches the documented intentional public endpoints. The `AdminPrefixMiddleware` is transparent and testable.

**Prerequisite before merging**: Confirm W-1 — that the backend middleware is deployed in the same release as the frontend `env.ts` change, or that CI/E2E environments have `VITE_API_URL` explicitly set.
