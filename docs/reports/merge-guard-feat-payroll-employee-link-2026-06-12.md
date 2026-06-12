# Pre-Merge Guard Report

**Branch**: `feat/payroll-employee-link` (PR-C: Employee Master + PayrollLine.userId FK)
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Report Date**: 2026-06-12
**Recommendation**: ⚠️ REVIEW (one Warning — see below)

---

## Branch Summary

Commits unique to branch (since diverge from main):

| Area | Commits |
|------|---------|
| PR-A: Employee Master backend (`EmployeeProfile` + `employees` module) | 1 |
| PR-B: Employee Master page `/employees` | 1 |
| PR-C: PayrollLine.userId nullable FK + snapshot derivation + EmployeeCombobox | 7 |
| Contacts/Party Master Mandatory P0–P4 | 7 |
| Supporting fixes (internal-control, etc.) | 2 |

### New Modules Introduced
- `apps/api/src/modules/employees/` — `EmployeesController`, `EmployeesService`, `EmployeeProfile` CRUD
- `apps/api/src/modules/sso-config/` — `GET /sso-config/effective` endpoint
- `apps/api/src/modules/two-factor/` — `TwoFactorController` (2FA management)
- `apps/web/src/components/employees/` — `EmployeeCombobox`, `ProvisionEmployeeDialog`, `EditEmployeeDialog`
- `apps/web/src/pages/EmployeesPage.tsx`

---

## Security & Guard Review

### `EmployeesController` (`apps/api/src/modules/employees/employees.controller.ts`)
✅ `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
✅ All 7 endpoints have `@Roles(...)` with appropriate roles (`OWNER`, `ACCOUNTANT`, `FINANCE_MANAGER`)

### `SsoConfigController` (`apps/api/src/modules/sso-config/sso-config.controller.ts`)
✅ `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
✅ `GET /sso-config/effective` has `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')`

### `TwoFactorController` (`apps/api/src/modules/two-factor/two-factor.controller.ts`)
⚠️ `@UseGuards(JwtAuthGuard)` at class level — **RolesGuard missing**
All 4 endpoints (`/enroll`, `/confirm`, `/disable`, `/backup-codes`) have **no `@Roles()` decorator**.

The absence is deliberate: these are self-service endpoints that any authenticated user should access to manage their own 2FA. `@CurrentUser('id')` scopes operations to the caller's own account. However, this violates the project rule *"ทุก method ต้องมี `@Roles(...)` decorator"*.

**Mitigation options**:
1. Add `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` (all roles) to each method — functionally identical but rule-compliant.
2. Add a code comment explaining the intentional omission per the CPA/2FA self-service design decision.

---

## Issues Found

### Critical
*None*

### Warning

| # | File | Issue |
|---|------|-------|
| W-1 | `apps/api/src/modules/two-factor/two-factor.controller.ts` | All 4 endpoints missing `@Roles()` decorator. `RolesGuard` is also absent at class level. Functionally safe (uses `@CurrentUser` to scope to own account), but violates the project rule requiring explicit `@Roles` on every method. Fix: add `RolesGuard` to `@UseGuards` and add `@Roles(...)` listing all roles to each endpoint. |

### Info

| # | File | Issue |
|---|------|-------|
| I-1 | `apps/api/src/modules/contracts/contracts.service.ts` | File is **1,245 lines** after branch changes. Exceeds the 500-line guidance. Not introduced by this branch (pre-existing growth), but flagged as technical debt. |
| I-2 | `apps/api/src/modules/accounting/accounting.service.ts` | `Number(p.amountDue) - Number(p.amountPaid ?? 0)` used in aging bucket loop; result stored as JS number in a summary object. For a reporting-only read path this won't cause a double-booking bug, but precision can drift on large amounts. Consider `new Prisma.Decimal(p.amountDue).minus(p.amountPaid ?? 0)`. Not introduced by PR-C — found in earlier commits in the branch. |

---

## Frontend Review

- `EmployeesPage.tsx`: uses `useQuery` + `useDebounce` ✅
- `ProvisionEmployeeDialog.tsx`: `useMutation` + `qc.invalidateQueries({ queryKey: employeeKeys.all })` + `toast.success/error` ✅
- `EditEmployeeDialog.tsx`: same pattern ✅
- `EmployeeCombobox.tsx`: uses `employeesApi` (wraps `api.get()`) ✅ — no raw `fetch()`
- Design tokens: uses `text-foreground`, `text-muted-foreground`, `bg-background` — no hardcoded hex ✅
- `leading-snug` applied on Thai text blocks ✅

---

## Verdict

The core Employee Master feature (PR-A through PR-C) is well-structured. Guards and mutations follow project conventions throughout. The only actionable finding before merge is **W-1** — the `TwoFactorController` needs `RolesGuard` + `@Roles` on each endpoint to satisfy the project security rule, even if the business logic is intentionally self-service.
