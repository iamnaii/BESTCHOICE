# Merge Guard Report — fix/users-page-polish

**Date**: 2026-04-18
**Branch**: `fix/users-page-polish`
**Author**: Akenarin Kongdach (last commit 2026-04-18 13:16)
**Base**: `origin/main`

## File Changes Summary

18 files changed, 1093 insertions(+), 348 deletions(−)

Commits (8):
- `feat(trade-in): auto-create Product on accept (PHONE_USED → PHOTO_PENDING)`
- `fix(trade-in): voucher PDF perf + logo + table UX polish`
- `fix(credit-checks): polish table + filters to match UsersPage/CustomersPage`
- `feat(credit-checks): show approver + approved date on table`
- `fix(customers-page): count in-progress portfolio as KPI, not raw ACTIVE status`
- `fix(customers-page): polish table UX + consistency with UsersPage`
- `feat(users-page): search/filters, sortable columns, kebab actions, bulk deactivate, last login`
- `fix(users-page): polish styling + surface owner-count security signal`

Key backend changes:
- `apps/api/src/modules/auth/auth.service.ts` — stamp `lastLoginAt` on successful login
- `apps/api/src/modules/trade-in/trade-in.service.ts` — auto-create `Product` on trade-in accept
- `apps/api/src/modules/users/users.service.ts` — filter system user accounts from list
- Migration: `20260501000000_add_user_last_login_at` — adds `last_login_at TIMESTAMP(3)` to `User`

---

## Issues by Severity

### Critical — 0 issues

No critical issues found:
- No new controllers without `@UseGuards` ✅
- No missing `deletedAt: null` in new queries (IMEI check correctly uses `findFirst` without soft-delete filter — intentional, as IMEI uniqueness must include soft-deleted records to avoid DB constraint violation) ✅
- No hardcoded secrets ✅
- No unparameterized `$queryRaw` ✅

### Warning — 1 issue

**W-001** `apps/api/src/modules/trade-in/trade-in.service.ts` line ~372 (diff line 72):

```ts
checklistResults: {
  ...
  agreedPrice: Number(costPrice),   // ← WARNING
  ...
} as unknown as Prisma.InputJsonValue,
```

`costPrice` is a `Prisma.Decimal`. Converting to JavaScript `Number` for storage inside a JSON blob is not a typed Decimal field violation, but it introduces float-precision risk for monetary values stored in JSON. Should use `costPrice.toFixed(2)` (string) or `costPrice.toString()` to preserve exact decimal representation in the JSON payload. At scale, amounts like `THB 9999.99` or values requiring exact cents may exhibit floating-point drift when read back.

**Recommendation**: Change `Number(costPrice)` → `costPrice.toString()` (or omit and let callers read from `tradeIn.offeredPrice` directly).

### Info — 2 items

**I-001**: `auth.service.ts` — successful login now **always** runs the `UPDATE` (stamp `lastLoginAt` + reset counters), even if `failedLoginAttempts === 0` and `lockedUntil === null`. The previous guard `if (user.failedLoginAttempts > 0 || user.lockedUntil)` was more efficient. The new unconditional write adds ~1 DB write per login. Functionally correct; acceptable trade-off for last-login tracking.

**I-002**: `users.service.ts` — `SYSTEM_USER_EMAILS` array is hardcoded as a module-level constant. If more system accounts are added in the future, this list needs manual maintenance. Consider storing them in an env variable or adding a `isSystemUser` boolean column when the list grows beyond 2–3 entries.

---

## Recommendation

**REVIEW**

One warning (W-001) should be addressed before merge: `Number(costPrice)` in the trade-in JSON payload is a Decimal precision risk. The fix is a one-line change (`Number(costPrice)` → `costPrice.toString()`). All other changes are clean — the trade-in auto-product creation, `lastLoginAt` tracking, and UI polishing are well-implemented.

**Required fix**: `apps/api/src/modules/trade-in/trade-in.service.ts` — change `agreedPrice: Number(costPrice)` to `agreedPrice: costPrice.toString()`.
