# Merge Guard Report — feat/admin-hardening-c3

**Date**: 2026-04-21  
**Branch**: `feat/admin-hardening-c3`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Recommendation**: 🚫 BLOCK — Critical security flaw in guard ordering must be fixed before merge

---

## File Changes Summary

| File | Type | Lines |
|------|------|-------|
| `apps/api/src/modules/auth/guards/jwt-audience.guard.ts` | New | +130 |
| `apps/api/src/modules/auth/guards/jwt-audience.guard.spec.ts` | New | +135 |
| `apps/api/src/common/middleware/admin-prefix.middleware.ts` | New | +32 |
| `apps/api/src/common/middleware/admin-prefix.middleware.spec.ts` | New | +45 |
| `apps/api/src/modules/auth/auth.service.ts` | Modified | +8 |
| `apps/api/src/modules/auth/auth.module.ts` | Modified | +3 |
| `apps/api/src/app.module.ts` | Modified | +10 |
| `apps/web/src/lib/env.ts` | Modified | +6 / -1 |

**Total**: 8 files, +373 insertions, -4 deletions

---

## Issues

### Critical

**C-001 · `JwtAudienceGuard` never enforces audience on authenticated routes**  
`JwtAudienceGuard` is registered as `APP_GUARD` (global guard). In NestJS, global guards run **before** per-controller guards. `JwtAuthGuard` is a per-controller guard — it runs after all global guards and is responsible for validating the JWT and setting `req.user`.

This means when `JwtAudienceGuard` runs, `req.user` is always `undefined` on any JWT-protected route. The guard's own code path for this case is:

```ts
// apps/api/src/modules/auth/guards/jwt-audience.guard.ts:103
if (!req.user) return true; // no user → let JwtAuthGuard handle it
```

Execution order for a request to `GET /api/customers`:
1. ThrottlerGuard (global) — runs
2. CsrfGuard (global) — runs
3. **JwtAudienceGuard (global)** — runs, `req.user` is `undefined` → returns `true` ✓ (audience NEVER checked)
4. JwtAuthGuard (controller) — validates JWT, sets `req.user` with any `aud` claim
5. RolesGuard (controller) — checks role
6. Route handler — executes

**Result**: A shop JWT (`aud='shop'`) can access all admin endpoints because the audience guard always defers and the per-controller guards only check role, not audience.

The spec comment "JwtAudienceGuard runs globally after per-controller JwtAuthGuard sets req.user" is incorrect — this is the opposite of how NestJS guard ordering works.

**Fix options (pick one):**
1. Make `JwtAudienceGuard` extend `AuthGuard('jwt')` so it both validates the JWT and checks audience in a single global guard — then remove per-controller `JwtAuthGuard` or keep it as a no-op alias.
2. Move audience validation into `JwtStrategy.validate()` — the strategy runs inside `JwtAuthGuard` and has access to the full decoded payload.
3. Register `JwtAuthGuard` as a global `APP_GUARD` (before `JwtAudienceGuard`) so `req.user` is set before the audience check runs.

Option 2 is the least invasive: in `JwtStrategy.validate()`, check that `payload.aud` matches the expected audience for the current request path and throw `ForbiddenException` if it doesn't.

---

### Warning

**W-001 · `env.ts` base URL change may break existing Axios calls with leading slashes**  
The default API base URL is changed from `/api` to `/api/admin`. If any `api.ts` axios calls use paths with a leading `/` (e.g., `api.get('/customers')`), Axios treats leading-slash paths as root-relative and **ignores** the baseURL. The request would go to `/customers` instead of `/api/admin/customers`, returning 404.

The existing codebase pattern documented in CLAUDE.md is `api.get('/customers')` (with leading slash). This needs verification across all ~55 page components before this change is safe.

**W-002 · `AdminPrefixMiddleware` comment overstates security boundary**  
The middleware comment states "the admin audience boundary is enforced at the JWT level via JwtAudienceGuard." Given C-001, this boundary does not exist in the current implementation.

---

### Info

**I-001 · Incorrect comment in `app.module.ts:259`**
```ts
// JwtAudienceGuard runs globally after per-controller JwtAuthGuard sets req.user.
```
This is factually wrong. Global guards run before per-controller guards in NestJS. The comment should be updated to accurately describe the intended vs. actual behavior once C-001 is fixed.

**I-002 · `aud: 'admin'` in JWT payload — forward-compatible**  
Adding `aud` and `scope` claims to existing JWTs (`auth.service.ts`) is a safe, additive change. Existing clients that don't check `aud` are unaffected. Once C-001 is fixed, this becomes the enforcement anchor.

---

## Verdict

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Warning | 2 |
| Info | 2 |

**🚫 BLOCK** — C-001 is a fundamental design flaw: the guard's core enforcement logic never runs for authenticated requests. The middleware, JWT claims, and test coverage are all well-structured — but the guard ordering defeats the security goal. Do not merge until the guard is restructured to run after JWT validation.
