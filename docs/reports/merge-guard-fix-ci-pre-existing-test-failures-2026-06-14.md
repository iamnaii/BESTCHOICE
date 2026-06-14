# Merge Guard Report — `fix/ci-pre-existing-test-failures`

**Date**: 2026-06-14  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local)  
**Last commit**: `ci(e2e): exclude the incomplete approval-workflow harness (#1192)` (2026-06-08)  
**Commits ahead of fork point**: 33  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| Category | Count |
|----------|-------|
| Total files changed | 209 |
| TypeScript/TSX files | 188 |
| Insertions | 19,500 |
| Deletions | 3,976 |

Key areas touched: auth module (2FA removal), employees module (new), contacts module (ensureRole endpoint), sso-config module (new), CLI backfill tools, extensive test additions across ~20 modules.

---

## Issues

### Critical — None

No Critical issues found:
- All new controllers (`employees.controller.ts`, `sso-config.controller.ts`) have `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)` on every method ✅
- New `POST :id/ensure-role` endpoint on `contacts.controller.ts` has `@Roles(...)` ✅
- No `Number()` calls on money/financial fields (all use `Prisma.Decimal`) ✅
- All service queries include `deletedAt: null` ✅
- No hardcoded secrets or API keys ✅
- No unparameterized `$queryRaw` — the one `$queryRaw` call is `SELECT current_database()` with no interpolation ✅
- No raw `fetch()` in new React components ✅

### Warning — Requires Owner Sign-Off

#### W1: 2FA Authentication Removed

Files: `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.service.ts`

The branch removes the entire two-factor authentication flow:
- `POST /auth/login/2fa` endpoint deleted
- `TwoFactorService` dependency removed from `AuthController`
- `signTempToken` / `verifyTempToken` private methods deleted from `AuthService`
- `OTP_REQUIRED` and `2FA_SETUP_REQUIRED` login states removed
- Login is now always single-step (`AUTHENTICATED` immediately after credentials)

The comment in the code says "2FA removed, login is single-step." This is an intentional downgrade of the authentication security model. **The owner should explicitly confirm this decision before merge**, especially since the system handles financial PII and the existing security rules (`.claude/rules/security.md`) do not document 2FA as removed.

#### W2: Large Test Files

Three new test files exceed 500 lines:
- `apps/api/src/modules/paysolutions/paysolutions.callbacks.spec.ts` — 530 lines
- `apps/api/src/modules/pdpa/pdpa.service.spec.ts` — 626 lines
- `apps/api/src/modules/reports/reports.service.portfolio.spec.ts` — 523 lines

Not blocking, but these could be split into focused sub-files for maintainability.

### Info

- The branch adds a full `employees` module (controller, service, DTOs, spec) with clean guard coverage and proper soft-delete patterns
- `contacts.ensureRole` endpoint is well-validated (`@IsIn(['SUPPLIER', 'CUSTOMER', 'TRADE_IN_SELLER'])`)
- `sso-config.controller.ts` is minimal with one properly-guarded GET endpoint
- The `backfill-payroll-user-fk.cli.ts` uses `$queryRaw` only for `SELECT current_database()` — no injection risk
- Thai validation messages present on all new DTO fields that have messages (several simple DTOs use `@IsOptional()` alone which is acceptable for query params)

---

## Decision

**⚠️ REVIEW** — No Critical security issues. Block on **W1 (2FA removal)**: this is a significant security regression that requires explicit owner confirmation before merge. W2 is advisory only.
