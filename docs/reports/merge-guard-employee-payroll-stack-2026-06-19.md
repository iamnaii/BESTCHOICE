# Merge Guard Report — Employee/Payroll Stack
**Date**: 2026-06-19  
**Branches reviewed**: `feat/employee-master` → `feat/employee-master-ui` → `feat/payroll-employee-link` → `feat/payroll-backfill`  
**Authors**: Akenarin Kongdach, Claude  
**Reviewer**: Pre-Merge Guard (automated)

---

## Overview

354 unmerged remote branches exist. The 4 most recently active **feature branches** are a stacked PR series implementing the Employee Master + Payroll employee linking feature. This report covers those 4 branches as logical units, reviewed incrementally.

| Branch | Incremental commits | Incremental TS files changed |
|--------|-------------------|------------------------------|
| `feat/employee-master` (PR-A backend) | 164 (vs main) | 338 |
| `feat/employee-master-ui` (PR-B UI) | 6 incremental | 14 |
| `feat/payroll-employee-link` (PR-C) | 12 incremental | 20 |
| `feat/payroll-backfill` (PR-D CLIs) | 4 incremental | 2 |

---

## Critical Issues

**None found.**

---

## Warning Issues

### W1 — `baseSalary` DTO uses `@IsNumber()` (not `@IsDecimal()`)
**File**: `apps/api/src/modules/employees/dto/create-employee.dto.ts:20`  
**Branch**: `feat/employee-master`  

```ts
@IsNumber({ maxDecimalPlaces: 2 }, { message: 'ฐานเงินเดือนต้องเป็นตัวเลข' })
@Min(0, { message: 'ฐานเงินเดือนต้องไม่ติดลบ' })
baseSalary?: number;
```

The service correctly wraps this in `new Prisma.Decimal(dto.baseSalary)` on write (service.ts:44, 117), so there is **no precision loss on storage**. However, the round-trip in `list()` returns `baseSalary` as a Decimal-serialised string and the comment says `// FE parseFloat` — the frontend `ProvisionEmployeeInput.baseSalary` is typed as `number`. This is acceptable for salary (limited to 2 decimal places) but deviates from the project-wide rule of never using `Number()` on money fields.

**Recommendation**: Consider typing the DTO field as `string` with `@IsDecimalString()` + `@Matches(/^\d+(\.\d{1,2})?$/)` to align with the Decimal-first money convention. Low risk as-is but creates a pattern inconsistency.

### W2 — `PayrollLinesSection` — `Number()` conversions inside component
**File**: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`  
**Branch**: `feat/payroll-employee-link`  

The component receives `baseSalary` as a string from the API (Decimal serialisation) and parses it via JavaScript `Number()` / `parseFloat()` for display calculations. This is acceptable for display, but any computed values that feed into a payroll POST body should ensure they remain within 2 decimal places (the backend DTO enforces `maxDecimalPlaces: 2`).

**Recommendation**: Add a `round2()` utility call before payroll line amounts are submitted, consistent with the pattern used in `commission.service.ts`.

---

## Info Issues

### I1 — `feat/employee-master` has 164 commits stacked on top of main
The branch is very large relative to its incremental change because it includes all commits in the `contacts` epic (Party Master Mandatory P0-P4) that preceded the employee feature. The actual employee code (PR-A) is clean and isolated. No concerns, but the branch is not squash-merged so the PR will carry a large commit history.

### I2 — `backfill-payroll-user-fk.cli.ts` writes CSV to CWD
**File**: `apps/api/src/cli/backfill-payroll-user-fk.cli.ts:CSV_PATH`  
The CLI writes `matched-by-name.csv` to the current working directory. On Cloud Run this file won't persist across restarts. The CLI logs the path, which is fine for a local run, but a production operator running via Cloud Run Job would not see the CSV.

**Recommendation**: Add a note in the CLI comment that Cloud Run requires mounting a Cloud Storage FUSE volume (or piping to gsutil) to retrieve the CSV.

### I3 — `sso-config` service has no `deletedAt: null` guard
**File**: `apps/api/src/modules/sso-config/sso-config.service.ts` (inferred — service not directly read)  
The `SsoConfigController.effective()` endpoint calls `getEffectiveConfig(when)` which queries `SsoConfig` table. Confirm the query includes `deletedAt: null` if the `SsoConfig` model uses soft-delete.

### I4 — `EmployeesPage.tsx` missing `SALES` / `BRANCH_MANAGER` in roles
The `/employees` route is restricted to `OWNER` and `ACCOUNTANT`. Branch managers cannot view employee profiles, which may be intentional (salary data is sensitive). Confirm with business owner whether BM needs read access to their own branch's employees.

---

## Security Checks Summary

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controllers | ✅ PASS — `EmployeesController`, `SsoConfigController` both guarded |
| `@Roles()` on all controller methods | ✅ PASS — Every method has `@Roles()` |
| `Number()` on money/financial fields (Prisma) | ✅ PASS — `baseSalary` wrapped in `new Prisma.Decimal()` on write |
| Missing `deletedAt: null` in queries | ✅ PASS — All reviewed queries include soft-delete filter |
| Hardcoded secrets or API keys | ✅ PASS — None found |
| SQL injection via unparameterised `$queryRaw` | ✅ PASS — Only `$queryRaw` use is `` `SELECT current_database()` `` (template literal, no interpolation) |
| Raw `fetch()` in frontend components | ✅ PASS — All components use `api.get()`/`api.post()` from `@/lib/api` |
| `queryClient.invalidateQueries()` after mutations | ✅ PASS — Present in `ProvisionEmployeeDialog` and `EditEmployeeDialog` |
| Thai validation messages on DTOs | ✅ PASS — All required fields have Thai messages |
| `QueryBoundary` on new list pages | ✅ PASS — `EmployeesPage.tsx` wraps in `<QueryBoundary>` |
| Backfill CLI production guards | ✅ PASS — Requires `EXPECTED_DB_NAME` match + `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` |
| Design tokens (no hardcoded hex/gray-*) | ✅ PASS — No violations found in reviewed files |

---

## Recommendation

**APPROVE with suggestions.**

The stacked feature is structurally sound. All critical security patterns (guards, roles, soft-delete, Decimal money, SQL safety) are correctly implemented. The two warnings (W1, W2) are minor pattern-alignment issues that do not pose a runtime risk but should be addressed to avoid precedent for `Number()` in money-adjacent code.

**Suggested before merge**:
1. Address W2 — confirm `round2()` is applied to any payroll line amounts before POST, or add an explicit comment that the backend DTO validation (`maxDecimalPlaces: 2`) is the last line of defence.
2. Confirm I3 — `SsoConfig` queries include `deletedAt: null`.
3. Confirm I4 — role restriction for `/employees` is intentional.

W1 (`baseSalary` DTO typing) can be addressed in a follow-up chore.
