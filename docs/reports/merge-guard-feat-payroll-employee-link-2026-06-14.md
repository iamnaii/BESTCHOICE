# Merge Guard Report — `feat/payroll-employee-link`

**Date**: 2026-06-14  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local)  
**Last commit**: `docs(payroll): align PR-C plan with FM-cleared PII decision (PR-C)` (2026-06-05)  
**Commits ahead of fork point**: 19  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| Category | Count |
|----------|-------|
| Total files changed | 90 |
| TypeScript/TSX files | ~75 |
| Insertions | 9,060 |
| Deletions | 959 |

Key additions: employees module (full CRUD), contacts `ensureRole` endpoint, SSO config endpoint for payroll pre-fill, `ExpenseDocumentsController.findOne` now role-aware, `PayrollLinesSection` with `EmployeeCombobox`, new `ContactCombobox`/`CreateContactModal` components, `VendorCombobox`.

---

## Issues

### Critical — None

- **`employees.controller.ts`** — class-level `@UseGuards(JwtAuthGuard, RolesGuard)`, every method has `@Roles(...)` ✅
- **`sso-config.controller.ts`** — properly guarded, single `@Get('effective')` with `@Roles(...)` ✅
- **`contacts.controller.ts`** — new `POST :id/ensure-role` has `@Roles(...)` ✅
- **`expense-documents.controller.ts`** — existing guards unchanged; the `findOne` change is additive (passes `user.role` to service) ✅
- **`suppliers.controller.ts`** — existing guards confirmed present on all methods ✅
- No `Number()` on money fields — `create-payroll.dto.ts` uses `@IsNumber({ maxDecimalPlaces: 2 })`, service uses `Prisma.Decimal` ✅
- All service queries use `deletedAt: null` ✅ (checked `employees.service.ts`: lines 34, 73, 103, 157, 165, 197)
- No hardcoded secrets ✅
- No `$queryRaw` in service code ✅
- `EmployeeCombobox`, `EditEmployeeDialog`, `ProvisionEmployeeDialog` all import from `@/lib/api/employees` which wraps `api.get/post` ✅
- All mutations (`save`, `del`, `mutation`) call `qc.invalidateQueries({ queryKey: employeeKeys.all })` ✅
- No new files exceed 500 lines ✅

### Warning — Requires Owner Sign-Off

#### W1: 2FA Authentication Removed

Files: `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.service.ts`

This branch removes the 2-step OTP login flow (the `fix/ci-pre-existing-test-failures` branch inherits from here). Login is now single-step. The removal is intentional per the in-code comment but is a security regression that requires explicit owner approval before merge given that the system handles financial PII and customer payment data.

#### W2: `ExpenseDocumentsService.findOne` Behavioral Change

File: `apps/api/src/modules/expense-documents/expense-documents.service.ts`

The `findOne(id)` signature changes to `findOne(id, role?)`. Passing the caller's role to a service method for access-scoping logic is acceptable, but should be verified: the service must not rely solely on the passed role for access control (which would bypass guards). The actual access control should remain in the guards; this should only be used for field-level visibility (e.g., hiding cost fields from SALES role).

### Info

- `create-payroll.dto.ts` has Thai validation messages on enum fields (`'ประเภทการจ้างไม่ถูกต้อง'`) but some simple `@IsNumber`/`@IsBoolean` fields omit messages — this is fine for internal system DTOs
- `ContactCombobox` and `CreateContactModal` use `useQuery`/`useMutation` correctly with cache invalidation
- `EnsureRoleDto` uses `@IsIn(['SUPPLIER', 'CUSTOMER', 'TRADE_IN_SELLER'])` — appropriate allowlist validation
- The `backfill-expense-vendor-fk.cli.ts` follows the same DB-guard + dry-run pattern as other CLIs

---

## Decision

**⚠️ REVIEW** — No Critical issues. Guard coverage is comprehensive across all new controllers. W1 (2FA removal) requires owner sign-off. W2 (role-aware `findOne`) should be spot-checked to confirm role is used only for field visibility, not access gating.
