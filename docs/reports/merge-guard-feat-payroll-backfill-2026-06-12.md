# Merge Guard Report — feat/payroll-backfill

**Date**: 2026-06-12  
**Branch**: `feat/payroll-backfill`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main** (unique): ~6 commits on top of employee-master base  
**Key PRs included**: PR-A (#1151 backend), PR-B (#1152 frontend UI), PR-C (#1153 payroll-employee FK)

---

## File Changes Summary (branch-unique vs main)

| Area | Files |
|------|-------|
| Prisma schema | `apps/api/prisma/schema.prisma` (EmployeeProfile model + PayrollLine.userId FK) |
| API — employees | `apps/api/src/modules/employees/` (controller, service, 3 DTOs, module) |
| API — SSO config | `apps/api/src/modules/sso-config/` (controller, service, module) |
| API — expense/payroll | `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts`, `expense-documents.service.ts`, `expense-documents.controller.ts` |
| Frontend | `apps/web/src/pages/EmployeesPage.tsx`, `components/employees/` (EditEmployeeDialog, EmployeeCombobox, ProvisionEmployeeDialog), `lib/api/employees.ts` |
| App routing | `apps/web/src/App.tsx` (lazy route `/employees`) |
| Tests | `employees.service.spec.ts`, `payroll-user-link.service.spec.ts`, `payroll.service.spec.ts`, `payroll.template.spec.ts` |

---

## Issues Found

### Critical — None

All checklist items pass:
- ✅ `EmployeesController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level; every method has `@Roles()`
- ✅ `SsoConfigController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level; `effective` endpoint restricted to `OWNER | BRANCH_MANAGER | FINANCE_MANAGER | ACCOUNTANT`
- ✅ `SsoConfigModule` is imported via `ExpenseDocumentsModule` (not app.module.ts directly) — this is correct NestJS module composition
- ✅ All queries include `deletedAt: null`
- ✅ `baseSalary` uses `Prisma.Decimal` throughout (no `Number()` on money)
- ✅ `createPayroll` service derives `employeeName`/`employeeTaxId` snapshots server-side when `userId` is present — client-supplied names not trusted (spec §4.2)
- ✅ Frontend uses `api.get()`/`api.post()` from `@/lib/api` exclusively — no raw `fetch()`
- ✅ All mutations (`ProvisionEmployeeDialog`, `EditEmployeeDialog`) call `queryClient.invalidateQueries({ queryKey: employeeKeys.all })`
- ✅ `EmployeesPage` uses `QueryBoundary` with `isError`, `error`, `onRetry`
- ✅ No hardcoded colors — no `text-gray-*`, `bg-gray-*`, `bg-white` in employee components
- ✅ No `any` types in new source files
- ✅ `CreatePayrollDto` has full class-validator coverage with Thai error messages

### Warning — 2

**W1: `pickable()` — `where.user` is overwritten when `search` is provided**  
File: `apps/api/src/modules/employees/employees.service.ts`

Pattern is functionally correct (both branches re-apply `isActive: true` and `deletedAt: null`), but fragile for maintenance. If the base `user` filter is changed, the search branch must be updated in parallel. Recommend a single construction:
```ts
where.user = { is: { isActive: true, deletedAt: null, ...(search ? { OR: [...] } : {}) } };
```

**W2: `EmployeeCombobox` — no loading skeleton while `open && query.isLoading`**  
File: `apps/web/src/components/employees/EmployeeCombobox.tsx`

The combobox shows `CommandEmpty` ("ไม่พบพนักงาน") during the initial load before results arrive. Users see a "not found" flash. A `CommandItem disabled` skeleton or loading indicator during `query.isLoading` would improve UX, consistent with `CustomerCombobox` and other combobox components in the codebase.

### Info

- `PayrollLineInput.userId` is `@IsString()` but should ideally be `@IsUUID()` to reject malformed IDs at the DTO boundary (service does the FK check, but earlier validation is cleaner).
- `backfill-payroll-user-fk.cli.ts` tier-2 CSV output writes to the current working directory (`matched-by-name.csv`). This is fine for a CLI tool, but the path should be documented in the usage comment.
- `EmployeesPage` correctly uses `useDebounce` for search — consistent with codebase conventions.
- `leading-snug` applied correctly on Thai text rows in `EmployeesPage`.

---

## Recommendation: **APPROVE**

The payroll backfill branch is production-ready. The Employee Master module (backend + UI) follows all project patterns: proper guards, Decimal money, soft-delete, QueryBoundary, no raw fetch, Thai validation messages. Backfill CLIs have thorough prod safeguards (EXPECTED_DB_NAME, ALLOW_PROD_BACKFILL, idempotency, 5s abort window, CSV audit trail for tier-2 name matches).

The two warnings (W1 fragile where pattern, W2 loading UX) are polish items, not blockers.

> **Merge order**: Run `backfill:employee-profiles` CLI first, then `backfill:payroll-user-fk`, before merging into main. See the PR-D spec in the branch for sequencing.
