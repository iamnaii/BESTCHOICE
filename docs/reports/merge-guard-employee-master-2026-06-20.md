# Pre-Merge Guard Report
**Date**: 2026-06-20  
**Reviewed by**: Pre-Merge Guard (automated)  
**Branches reviewed** (3 most recently updated, unmerged):

1. `fix/ci-pre-existing-test-failures` — last pushed 2026-06-08
2. `feat/employee-master` — last pushed 2026-06-04
3. `feat/employee-master-ui` — last pushed 2026-06-04

*(Related branches not reviewed in detail: `feat/payroll-employee-link`, `feat/payroll-backfill` — both follow the same patterns as the branches above; spot-checked for money handling and guard issues only.)*

---

## Branch 1: `fix/ci-pre-existing-test-failures`

### Summary
Test-only fix that unblocked the CI gate. Three pre-existing failures were broken on every open PR:

1. `contract-signing-workflow.spec.ts` — mock had drifted; added `findUniqueOrThrow`, `installmentSchedule.count/createMany`, and `createdAt` field the code now reads.
2. `env-validation.spec.ts` — removed 2 stale tests asserting `ENCRYPTION_KEY` was required in prod; the guard they tested was tied to 2FA/TOTP, removed in #1169. `PII_ENCRYPTION_KEY` is still enforced (tests remain).
3. `approval-workflow.e2e-spec.ts` — re-excluded from `jest-e2e.json` testPathIgnorePatterns; it's a placeholder spec written ahead of its dependency PRs whose early-return skips no longer fire now that the deps landed.

### Files changed (TS only)
| File | Change |
|------|--------|
| `apps/api/src/modules/contracts/contract-signing-workflow.spec.ts` | Added 4 missing mock methods/fields |
| `apps/api/src/utils/env-validation.spec.ts` | Removed 2 stale tests |
| `apps/api/e2e/approval-workflow.e2e-spec.ts` | Added `@excluded` header comment |
| `apps/api/e2e/jest-e2e.json` | Added `testPathIgnorePatterns` entry |

### Issues

**Critical**: None  
**Warning**: None  
**Info**: 
- The `approval-workflow.e2e-spec.ts` exclusion is tracked as issue #1192. The exclusion is the right call given the spec's placeholder DI harness, but needs to be re-enabled once the harness is completed.

### Recommendation: ✅ APPROVE

---

## Branch 2: `feat/employee-master`

### Summary
New `employees` NestJS module: `EmployeeProfile` model (1:1 with `User`) + CRUD endpoints with PII-safe `list`/`pickable`/`provisionable` endpoints. Backend only (no frontend).

### Key files
| Path | Description |
|------|-------------|
| `apps/api/src/modules/employees/employees.controller.ts` | CRUD controller |
| `apps/api/src/modules/employees/employees.service.ts` | Service with nationalId masking |
| `apps/api/src/modules/employees/dto/*.ts` | Create / Update / List DTOs |
| `apps/api/prisma/migrations/20260969000000_add_employee_profile/migration.sql` | Schema migration |

### Security checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller | ✅ Present at class level |
| `@Roles(...)` on every method | ✅ All 7 methods decorated |
| Money fields use `Prisma.Decimal` | ✅ `baseSalary` uses `new Prisma.Decimal(dto.baseSalary)` |
| `deletedAt: null` in all queries | ✅ `findFirst({ where: { id, deletedAt: null } })`, `count({ where: { deletedAt: null } })` |
| No raw `$queryRaw` (only in CLI, safe static SQL) | ✅ No dynamic interpolation |
| No hardcoded secrets | ✅ None |
| Module registered in `app.module.ts` | ✅ Confirmed |
| Migration uses `DECIMAL(12,2)` for `base_salary` | ✅ Confirmed |
| PII protection on `nationalId` in list endpoint | ✅ Masked to `•••••••••{last4}` |

### Issues

**Critical**: None

**Warning**:
- `findOne()` returns the full `nationalId` without masking (line ~88 of service). The intent is explicit per the comment ("full nationalId — endpoint is OWNER/ACCOUNTANT only") and the guard is correct. However, if role requirements ever loosen, this would leak PII silently. Consider adding a comment warning that masking must be applied if roles expand beyond OWNER/ACCOUNTANT.

**Info**:
- `userSelect` object includes `nationalId: true` — this is needed for `findOne` but pulling it in for `list()` and then re-masking at application layer (rather than selecting a pre-masked field) means the raw PII travels through the ORM layer. This is the established pattern in the codebase so not a regression.
- Soft-deleting an `EmployeeProfile` leaves any `PayrollLine.userId` FK pointing to the deleted profile's user. This is acceptable (PayrollLines are historical documents), but worth noting in migration docs.

### Recommendation: ✅ APPROVE

---

## Branch 3: `feat/employee-master-ui`

### Summary
Frontend: `EmployeesPage` + `ProvisionEmployeeDialog` + `EditEmployeeDialog` + `employeesApi` client. Route added at `/employees`.

### Key files
| Path | Description |
|------|-------------|
| `apps/web/src/pages/EmployeesPage.tsx` | Main list page |
| `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx` | New employee dialog |
| `apps/web/src/components/employees/EditEmployeeDialog.tsx` | Edit/soft-delete dialog |
| `apps/web/src/lib/api/employees.ts` | Typed API client |

### Frontend pattern checks

| Check | Result |
|-------|--------|
| `useQuery`/`useMutation` (no raw fetch) | ✅ All data via React Query |
| `api.get()`/`api.post()` from `@/lib/api` | ✅ `employeesApi` wraps `api.*` |
| `invalidateQueries()` after mutations | ✅ All 3 mutations invalidate `employeeKeys.all` |
| `toast.success()`/`toast.error()` from `sonner` | ✅ Present |
| No hardcoded hex colors | ✅ Uses `bg-muted`, `text-foreground`, `text-primary` tokens |
| `useDebounce` for search | ✅ `useDebounce(search)` in EmployeesPage |
| `QueryBoundary` for data list | ✅ Wraps DataTable |
| `ConfirmDialog` for destructive action | ✅ Delete uses `ConfirmDialog` (not `window.confirm()`) |
| `React.lazy()` route | ✅ `const EmployeesPage = lazy(...)` |
| Inside `<ProtectedRoute><MainLayout /></ProtectedRoute>` parent | ✅ At line 337 of App.tsx |

### Issues

**Critical**: None

**Warning**:
- **Missing role restriction on `/employees` route** (`App.tsx:497`). The route is `<Route path="/employees" element={<EmployeesPage />} />` with no `ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}` wrapper. All authenticated users (including SALES, BRANCH_MANAGER) can navigate to `/employees`. The API will 403 them and `QueryBoundary` will show an error, so no data leaks — but the UI should gate at the router level to match the API's OWNER/ACCOUNTANT guard. Compare: `/branches`, `/ads`, `/users` which all use `ProtectedRoute roles`.

  **Fix**: wrap with `<ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}><EmployeesPage /></ProtectedRoute>`

**Info**:
- `ProvisionEmployeeDialog` and `EditEmployeeDialog` use native `<select>` and `<input type="checkbox">` for employment type and SSO eligibility instead of shadcn/ui `Select`/`Checkbox` components. The convention in this codebase is to use shadcn/ui throughout. This is a cosmetic inconsistency — no functional impact.
- `EmployeesPage` uses inline `canManage` check to hide the "เพิ่มพนักงาน" button from non-OWNER/ACCOUNTANT users. This is a UI convenience only (API guards the actual endpoint); consistent with the pattern on other pages.

### Recommendation: ⚠️ REVIEW — fix Warning before merge

---

## Spot-check: `feat/payroll-employee-link` & `feat/payroll-backfill`

These branches build on `feat/employee-master` and were spot-checked (not full review):

- **`payroll.template.ts`**: Uses `Decimal` throughout (`new Decimal(0)`, `.plus(l.baseSalary.toString())`). No `Number()` on money. ✅
- **`PayrollCustomService`**: Uses `Prisma.Decimal`, validates whitelist from DB, throws `BadRequestException` with Thai messages. ✅
- **`backfill-payroll-user-fk.cli.ts`**: No HTTP endpoint. DB-name guard, dry-run default, idempotent `where: { userId: null }`, audit trail for tier-2 matches. `$queryRaw` is used only for `SELECT current_database()` (static, no interpolation). ✅

---

## Overall Status

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `fix/ci-pre-existing-test-failures` | 0 | 0 | 1 | ✅ APPROVE |
| `feat/employee-master` | 0 | 1 | 2 | ✅ APPROVE |
| `feat/employee-master-ui` | 0 | 1 | 2 | ⚠️ REVIEW |

### Action items before merging `feat/employee-master-ui`

1. **[Warning]** Add `ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}` wrapper around `/employees` route in `apps/web/src/App.tsx`
2. **[Info, optional]** Replace native `<select>` and `<input type="checkbox">` with shadcn/ui `Select` and `Checkbox` in `ProvisionEmployeeDialog` and `EditEmployeeDialog`

The employee-master series (`feat/employee-master`, `feat/payroll-employee-link`, `feat/payroll-backfill`) can merge after the UI route fix is applied to `feat/employee-master-ui`.
