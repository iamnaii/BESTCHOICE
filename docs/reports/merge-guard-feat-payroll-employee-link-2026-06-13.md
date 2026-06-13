# Pre-Merge Guard Report

**Branch**: `feat/payroll-employee-link`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Date**: 2026-06-13
**Reviewed by**: Pre-Merge Guard Agent

---

## File Changes Summary

| Commit | Files | Description |
|--------|-------|-------------|
| `45021c3e` | Prisma schema + migration | Add `PayrollLine.userId` nullable FK |
| `f31fd9ae` | `create-payroll.dto.ts`, `expense-documents.service.ts` | `PayrollLineInput.userId` + optional `employeeName` |
| `363070c1` | `expense-documents.service.ts`, spec | Derive employee snapshot from `userId` + PII mask on read |
| `d0d66466` | spec | JE anti-regression: `userId` does not affect journal entry |
| `2caedc10` | `sso-config.controller.ts`, `sso-config.module.ts`, spec | New `GET /sso-config/effective` endpoint |
| `d53eb4af` | `apps/web/src/lib/api/employees.ts`, `ssoConfig.ts` | API client: `pickable` + `ssoConfig.effective` |
| `8b77d262` | `EmployeeCombobox.tsx`, test | New `EmployeeCombobox` component |
| `c22eb56c` | `PayrollLinesSection.tsx`, `ExpenseFormV4.tsx`, test | Wire `EmployeeCombobox` into payroll form + SSO pre-fill |
| `ca3c8e0f` | docs only | PR-C plan alignment |

**Scope**: Employee Master linkage to PayrollLine (PR-C of the employee master epic).

---

## Issues Found

### Critical
_None._

### Warning

- **`@IsString` decorators without Thai `message` options** (Info-level severity here):
  `CreateEmployeeDto` has several `@IsString()` decorators on optional fields
  (`position`, `bankName`, `bankAccountNo`, `taxIdOverride`, `note`, `search`) with no
  custom message. Convention requires Thai messages on validation decorators. Since all these
  fields are `@IsOptional()` these validators only fire when the field IS present but not a
  string, which is an edge case — low impact, but inconsistent with the codebase standard.

- **Temporary `as string` cast comment residue** (`f31fd9ae` → resolved in `363070c1`):
  The `as string` casts introduced as stubs in task 2 were cleanly removed in task 3.
  No residual casts remain in production code. ✅

### Info

- **`SsoConfigController` roles include `BRANCH_MANAGER`** but not `SALES`.
  The payroll creation endpoint (which this pre-fills) is `OWNER/FINANCE_MANAGER/ACCOUNTANT`
  only — `BRANCH_MANAGER` would not be creating payrolls. Low risk (read-only endpoint,
  returns non-PII SSO ceiling/rate data), but worth noting for role consistency.

- **`EmployeeCombobox.tsx` (~125 lines) — correct API pattern**: Uses `useQuery` +
  `employeesApi.pickable()` from `@/lib/api`. No raw `fetch()`. ✅

- **`PayrollLinesSection.tsx` SSO pre-fill**: Uses `useQuery` + `ssoConfigApi.effective()`.
  No mutations in this component (form submit is at the parent level). ✅

- **PII gating is correctly implemented**: `GET /employees/pickable` does NOT return
  `nationalId` (would leak PII to `FINANCE_MANAGER`). `nationalId` flows only via
  `OWNER/ACCOUNTANT` endpoints. Server derives `taxId` at payroll create from the
  employee profile. ✅

- **`deletedAt: null` present on all new queries**: `employeeProfile.findMany`, `user.findFirst`
  in both service and CLI all include `deletedAt: null` filters. ✅

- **Money fields use `Prisma.Decimal`**: `baseSalary` stored and retrieved as `Prisma.Decimal`,
  not `Number()`. ✅

- **Guards on all new endpoints**:
  - `SsoConfigController`: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅
  - `EmployeesController` (PR-A, commit `55cd8878`): `@UseGuards(JwtAuthGuard, RolesGuard)`
    at class level, `@Roles(...)` on every method ✅

---

## Recommendation

**✅ APPROVE with minor note**

The branch implements payroll ↔ employee link cleanly:
- Server-side PII derivation (spec §4.2 — never trust client snapshot) ✅
- Correct money type handling (Prisma.Decimal) ✅
- Guards and roles on all new endpoints ✅
- Soft-delete filters present ✅
- React Query patterns used correctly on the frontend ✅

Minor action before merge: add Thai `message` strings to the bare `@IsString()` decorators
on optional employee DTO fields (`position`, `bankName`, `bankAccountNo`, etc.) for
convention compliance. Not blocking.
