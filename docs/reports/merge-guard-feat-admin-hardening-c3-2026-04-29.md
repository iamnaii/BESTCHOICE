# Pre-Merge Guard Report: feat/admin-hardening-c3
**Date**: 2026-04-29  
**Reviewer**: Pre-Merge Guard Agent  
**Recommendation**: 🔴 BLOCK

---

## Branch Summary

| Field | Value |
|-------|-------|
| Branch | `feat/admin-hardening-c3` |
| Unique commits ahead of main | ~15 |
| Files changed (TS/TSX) | ~180 |
| New modules/guards | `JwtAudienceGuard`, `AdminPrefixMiddleware`, `exchange/`, `broken-promise.cron.ts` |

### Top commits
- `feat(admin)`: Batch C2 — TOTP 2FA + 2-step login + force enrollment
- `feat(shop)`: Phase 1 — foundation + catalog (read-only browse)
- `feat(admin)`: Batch C1 — robots noindex + new device alert
- `feat(admin-c3)`: JWT audience claim + `JwtAudienceGuard`
- `feat(admin-c3)`: `AdminPrefixMiddleware` — strip `/admin` from `/api/admin/*`

---

## Critical Issues (must fix before merge)

### C-1 · P0 API outage — `JwtAudienceGuard` always throws 403 on admin requests

`jwt.strategy.ts` removes `aud` from both the `JwtPayload` interface and the `validate()` return object. The `JwtAudienceGuard` (registered as `APP_GUARD`) reads `req.user.aud`, which is now always `undefined`, and for all non-public `/api/*` paths evaluates:

```typescript
if (aud !== 'admin') {  // undefined !== 'admin' → always true
  throw new ForbiddenException('Admin endpoint requires admin audience');
}
```

Every authenticated admin request will receive `403 ForbiddenException`. The JWT tokens in the database still have `aud: 'admin'` in their payload (signed correctly in `auth.service`), but the strategy strips it before `req.user` is set. The unit tests in `jwt-audience.guard.spec.ts` do not catch this because they manually set `req.user = { aud: 'admin' }`.

**Fix**: Restore `return { ...user, aud: payload.aud }` in `jwt.strategy.ts` and add `aud` back to `JwtPayload` + `CachedUser` interfaces.

---

### C-2 · P1 Account lockout race condition — v3 hardening regression

`auth.service.ts` replaces the atomic Prisma increment:
```typescript
// BEFORE (atomic)
data: { failedLoginAttempts: { increment: 1 } }
```
with a read-modify-write:
```typescript
// AFTER (racy)
const nextAttempts = user.failedLoginAttempts + 1;
data: { failedLoginAttempts: nextAttempts }
```

Two concurrent failed-password requests can both read `failedLoginAttempts = 4`, both compute `5`, and both write `5` — the lockout fires once instead of the expected second time, and the counter is under-counted. This was an explicitly documented v3 hardening fix ("Audit finding P1"). The branch also removes the explanatory comment.

**Fix**: Restore `{ increment: 1 }` for `failedLoginAttempts`.

---

### C-3 · P1 `localhost:5174` in CORS allowlist unconditionally in production

`main.ts` removes the `NODE_ENV !== 'production'` guard that was added in v3 hardening (documented as "Audit finding P0-#8"):

```typescript
// BEFORE — guarded
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:5174');
}

// AFTER — unguarded
allowedOrigins.push('http://localhost:5174');
```

In production, any page served from `localhost:5174` can make credentialed cross-origin requests and receive the httpOnly refresh-token cookie.

**Fix**: Restore the `NODE_ENV !== 'production'` guard.

---

### C-4 · P1 Helmet security headers removed

`import helmet from 'helmet'` and `app.use(helmet({…}))` are removed from `main.ts`. This strips `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security`, and `Referrer-Policy: no-referrer` from all API responses. These were added in response to an audit finding and remain in `main`.

**Fix**: Restore the `helmet()` middleware call with the same configuration as `main`.

---

### C-5 · P1 `loginWith2FA` endpoint loses class-validator DTO

`LoginTempTokenDto` (enforcing `@Length(1, 512)` on `tempToken` and `@Length(6, 8)` on `otp`) is deleted. It is replaced with a raw `body: { tempToken: string; otp: string }` type and a manual null-check only. The global `ValidationPipe` with `whitelist: true` cannot strip unknown properties without a DTO class. The comment `// (Audit finding P0-#9) Body validated by LoginTempTokenDto` is also removed.

**Fix**: Restore `LoginTempTokenDto` with class-validator decorators and use it on `@Body()` in `loginWith2FA`.

---

## Warning Issues (should fix before merge)

### W-1 · `ExchangeService.executeExchange` — soft-deleted payments included

`include: { payments: true }` in `executeExchange()` fetches payments without `where: { deletedAt: null }`. This inflates the outstanding balance calculation. The `getExchangeQuote` method correctly uses the filter.

**Fix**: Add `payments: { where: { deletedAt: null } }` in the `executeExchange` include.

---

### W-2 · `ExchangeService` — `Number()` on Decimal money fields for DB writes

`sellingPrice`, `outstandingBalance`, `financedAmount`, `monthlyPayment`, `interestRate`, and `amountDue` are written as JS `number` values. The project rule requires `Prisma.Decimal` for all money fields in DB writes.

**Fix**: Use `Prisma.Decimal` throughout `ExchangeService` financial arithmetic.

---

### W-3 · `reopenPeriod` drops `userId` from audit trail

`AccountingController.reopenPeriod` previously passed `req.user.id` to `monthlyCloseService.reopenPeriod`. The branch removes `req` extraction entirely. Period reopening is an `OWNER`-only action and must maintain user attribution in the audit log.

**Fix**: Restore `@Request() req` extraction and pass `req.user.id` to the service.

---

## Info

| # | Note |
|---|------|
| I-1 | `me/preferences` endpoint removed — verify no frontend/LIFF pages call `PATCH auth/me/preferences` |
| I-2 | `JwtPayload.email` and `branchId` made non-optional — positive hygiene |
| I-3 | `ChartOfAccountsController.findAll` drops `companyId` query param — verify no multi-entity filtering is needed |
| I-4 | Backend `fetch()` calls in `facebook.adapter.ts`, `broadcast.service.ts` are expected external HTTP — not a rule violation |

---

## Recommendation: 🔴 BLOCK

Five critical issues, all security-relevant:

- **C-1 is a P0 outage**: every authenticated admin request returns 403 due to `req.user.aud` never being set
- **C-2, C-3, C-4, C-5** are explicit regressions of v3 audit-hardening fixes that were deliberately merged

All five must be fixed before re-review. Suggested approach: cherry-pick the genuinely new C3 commits (TOTP 2FA, new device alert, JWT audience infrastructure) onto a fresh branch from `main`, being careful not to carry the reversions.
