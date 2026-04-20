# Merge Guard Report — feat/admin-hardening-c1

**Date**: 2026-04-20  
**Branch**: `feat/admin-hardening-c1`  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local)  
**Recommendation**: ✅ **APPROVE** (with notes)

---

## File Changes Summary

11 files changed, 673 insertions(+), 7 deletions(-)

| File | Type | Lines |
|------|------|-------|
| `prisma/schema.prisma` | Modified — new `KnownDevice` model | +41 |
| `prisma/migrations/…/migration.sql` | New migration | +44 |
| `auth/auth.controller.ts` | Modified — pass `acceptLanguage` header | +8 |
| `auth/auth.module.ts` | Modified — `forwardRef(LineOaModule)` | +2 |
| `auth/auth.service.ts` | Modified — `AuthMeta.acceptLanguage` | +2 |
| `auth/login-audit.service.ts` | Modified — device fingerprint + LINE alert | +111 |
| `auth/login-audit.service.spec.ts` | Modified — 3 new test scenarios | +87 |
| `utils/device-fingerprint.util.ts` | New utility | +182 |
| `utils/device-fingerprint.util.spec.ts` | New tests | +126 |
| `apps/web/index.html` | `<meta name="robots" content="noindex">` | +1 |
| `apps/web/public/robots.txt` | Block all crawlers | +47 |

**What the branch does**: Adds device fingerprinting to the login audit flow. On successful login, a SHA-256 fingerprint is computed from `userAgent + ipPrefix + acceptLanguage`. First-ever fingerprint for a user triggers a fire-and-forget LINE alert to `SHOP_STAFF_LINE_ID`. Also adds `robots.txt` + noindex meta to prevent the admin app from being indexed.

---

## Issues Found

### Critical
_None_

### Warning

**W-1 — Circular dependency via `forwardRef()`** (`auth.module.ts`)  
`AuthModule` now imports `LineOaModule` via `forwardRef()`, creating a circular dependency with `LineOaModule` (which likely imports `AuthModule` or shares providers). Circular deps in NestJS can cause subtle initialization-order issues and make dependency graphs hard to reason about.

_Suggestion_: Move the LINE-notification responsibility to a standalone `NotificationModule` (or a `DeviceAlertService` in a leaf module) instead of coupling `AuthModule` ↔ `LineOaModule`.

**W-2 — Extra DB round-trips on the login hot path** (`login-audit.service.ts`)  
`record()` now does `knownDevice.findUnique` + `knownDevice.upsert` + `user.findUnique` on every successful login (fire-and-forget for the last two, but `findUnique` is blocking). Under high concurrency this adds latency before the audit log write completes.

_Suggestion_: Batch the `findUnique + upsert` into a single `upsert` and check `create.loginCount === 1` to detect first-time devices, eliminating the pre-check round-trip.

### Info

**I-1 — `SHOP_STAFF_LINE_ID` not in `.env.example`**  
The new env var `SHOP_STAFF_LINE_ID` is referenced in `login-audit.service.ts` but should be documented in `.env.example` with a comment, otherwise new dev environments will silently skip LINE alerts without knowing why.

**I-2 — `device-fingerprint.util.ts` is 182 lines**  
Reasonable for the scope; no action needed.

---

## Test Coverage

- `device-fingerprint.util.spec.ts`: 11 tests covering fingerprint stability, IPv4/IPv6 prefix computation, IPv6-mapped IPv4, loopback, garbage inputs, and UA parsing for 6 browser/OS combinations. ✅
- `login-audit.service.spec.ts`: 3 new tests — new device detection, repeat device increment, failed login guard. ✅

---

## Security Assessment

- Auth controller still protected by existing guards — only the *login* endpoint (intentionally public) calls `LoginAuditService`.
- New-device LINE alert is fire-and-forget and errors are swallowed — no login path impact if LINE is down. ✅
- Failed logins do NOT create `KnownDevice` records (security: prevents attacker from "registering" devices). ✅
- SHA-256 fingerprint is a hash — no raw PII stored in `KnownDevice`. ✅
