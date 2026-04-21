# Merge Guard Report — feat/admin-hardening-c3
**Date**: 2026-04-21  
**Branch**: `feat/admin-hardening-c3`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Recommendation**: 🔴 **BLOCK**

---

## File Changes Summary

8 files changed, 373 insertions(+), 4 deletions(-)

| Area | Files |
|------|-------|
| Backend (new) | `jwt-audience.guard.ts`, `jwt-audience.guard.spec.ts`, `admin-prefix.middleware.ts`, `admin-prefix.middleware.spec.ts` |
| Backend (modified) | `app.module.ts` (register APP_GUARD + move middleware), `main.ts` (remove Express-level middleware), `auth.service.ts` (add `aud` claim to tokens) |
| Frontend (modified) | `apps/web/src/lib/env.ts` (baseURL → `/api/admin`) |

---

## Feature Overview

Adds a `JwtAudienceGuard` (global APP_GUARD) that enforces JWT `aud` claims by path — `aud=admin` for standard endpoints, `aud=shop` for `/api/shop/*`, with allowlisted public paths. `AdminPrefixMiddleware` rewrites `/api/admin/*` → `/api/*` so existing controllers handle admin-app requests transparently. Frontend `env.ts` now defaults to `/api/admin` base URL.

---

## Issues by Severity

### Critical

**[CRITICAL-1] AdminPrefixMiddleware moved from Express level to NestJS MiddlewareConsumer — contradicts documented reliability constraint**

File: `apps/api/src/app.module.ts` (lines changed) vs `apps/api/src/main.ts` (lines removed)

The branch removes the Express-level `AdminPrefixMiddleware` registration from `main.ts` and replaces it with NestJS `MiddlewareConsumer.forRoutes('*')`.

The code on `main` that is being deleted includes an explicit warning:

```
// AdminPrefixMiddleware MUST run at Express level (not via MiddlewareConsumer)
// so it executes before NestJS routing layer. Rewrites /api/admin/* → /api/*
// so existing controllers (mounted at /api/X via setGlobalPrefix) handle the
// request transparently. NestJS module-level middleware via forRoutes('*')
// is unreliable here because path-to-regexp matching can interact poorly
// with the global prefix; raw app.use() guarantees execution on every request.
```

The concern: NestJS routing rejects unknown paths with 404 before `MiddlewareConsumer` middleware can rewrite the URL. The global `setGlobalPrefix('api')` + NestJS router can short-circuit unrecognized `/api/admin/*` paths before the middleware has a chance to rewrite them. The Express-level `app.use()` runs unconditionally before NestJS routing.

**Risk**: All `/api/admin/*` requests may return 404 after this change, breaking the admin frontend entirely.

**Fix required**: Restore the Express-level registration in `main.ts`, or validate via integration test that `POST /api/admin/auth/login` returns 200 (not 404) with the NestJS-level middleware.

---

### Warning

**[WARN-1] JwtAudienceGuard aud claim effectively unenforced on authenticated endpoints**

File: `apps/api/src/modules/auth/guards/jwt-audience.guard.ts` (pre-existing on main)

`JwtAudienceGuard` is registered as `APP_GUARD` (global, runs first). Per-controller `JwtAuthGuard` runs after it. When `JwtAudienceGuard` runs, `req.user` is not yet set (JwtAuthGuard hasn't executed), so the guard returns `true` (defers) on all authenticated endpoints. The aud claim is never actually checked.

This is a pre-existing design on `main` and not introduced by this branch, but merging this branch promotes it as "working" security when it is architecturally non-functional.

**Fix** (not blocking this PR, but should be tracked): Either promote `JwtAuthGuard` to `APP_GUARD` (registered before `JwtAudienceGuard`) or parse the JWT in a middleware that sets `req.user` before guards run.

---

### Info

**[INFO-1] `jwt-audience.guard.spec.ts` test for "passes through when req.user undefined on admin path"**  
Test verifies that the guard returns `true` when req.user is undefined on `/api/customers`. This is the deferral behavior documented in WARN-1. The test is correct for the current implementation, but implicitly confirms the guard is not enforcing aud on authenticated endpoints.

**[INFO-2] Branch is 11 commits behind main**  
The branch has been partially merged into main (JwtAudienceGuard and AdminPrefixMiddleware are already on main). The unique delta in this branch is only: moving AdminPrefixMiddleware registration + frontend env.ts. Recommend a rebase before merge to reduce conflict surface.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers with missing guards | ✅ No new controllers |
| `Number()` on money fields | ✅ None |
| `deletedAt: null` in queries | ✅ Not applicable (no DB queries) |
| Hardcoded secrets | ✅ None |
| SQL injection | ✅ Not applicable |

---

## Summary

The `AdminPrefixMiddleware` relocation from Express level to NestJS `MiddlewareConsumer` is the blocking issue. The existing `main.ts` comment explicitly documents why the Express level is required. Merging as-is risks a complete routing regression for the admin frontend. Fix: restore `app.use()` registration in `main.ts` or provide an integration test proving NestJS-level middleware works with the global prefix.
