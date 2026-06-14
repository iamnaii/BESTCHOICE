# Pre-Merge Guard Report
**Date**: 2026-06-14  
**Branches reviewed**: `feat/employee-master`, `feat/employee-master-ui`, `feat/payroll-backfill`

---

## Branches Reviewed

| Branch | Unique commits (vs main) | Focus |
|--------|--------------------------|-------|
| `feat/employee-master` | 10 (PR-A backend) | NestJS EmployeeProfile module + schema |
| `feat/employee-master-ui` | 6 (PR-B frontend) | React EmployeesPage + dialogs |
| `feat/payroll-backfill` | 3 (PR-D CLI) | Backfill CLIs for employee profiles + payroll FK |

These branches form a stacked series: `feat/employee-master` ← `feat/employee-master-ui` ← `feat/payroll-backfill`.

### File changes summary

**feat/employee-master** (new files):
- `apps/api/prisma/schema.prisma` — `EmployeeProfile` model + `EmploymentType` enum
- `apps/api/src/modules/employees/employees.controller.ts`
- `apps/api/src/modules/employees/employees.service.ts`
- `apps/api/src/modules/employees/employees.module.ts`
- `apps/api/src/modules/employees/dto/{create,update,list}-employee.dto.ts`
- `apps/api/src/app.module.ts` — EmployeesModule imported

**feat/employee-master-ui** (new files):
- `apps/web/src/pages/EmployeesPage.tsx`
- `apps/web/src/components/employees/EditEmployeeDialog.tsx`
- `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx`
- `apps/web/src/lib/api/employees.ts`
- `apps/web/src/App.tsx` — new route + lazy import
- `apps/web/src/config/menu.ts` — OWNER + ACCOUNTANT menu entries
- `apps/web/src/pages/__tests__/EmployeesPage.test.tsx`

**feat/payroll-backfill** (new files):
- `apps/api/src/cli/backfill-employee-profiles.cli.ts`
- `apps/api/src/cli/backfill-payroll-user-fk.cli.ts`
- `apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts`

---

## Issues by Severity

### 🔴 Critical (must fix before merge)

#### C1 — `/employees` route missing role-based `ProtectedRoute` wrapper

**File**: `apps/web/src/App.tsx:497`

```tsx
// Current (unprotected at route level):
<Route path="/employees" element={<EmployeesPage />} />

// Required (mirrors /users pattern):
<Route
  path="/employees"
  element={
    <ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>
      <EmployeesPage />
    </ProtectedRoute>
  }
/>
```

**Why critical**: `EmployeesPage` displays employee PII — national ID (masked but present), salary (`baseSalary`), bank name, bank account number, SSO eligibility. Without a route-level `ProtectedRoute roles` guard, any authenticated user (SALES, BRANCH_MANAGER, FINANCE_MANAGER) can navigate directly to `/employees` by typing the URL. The API returns 403 so no data leaks to them, but:
1. The page renders and fires the API call before `QueryBoundary` shows an error — network traffic and timing are visible.
2. This violates the project pattern: `/users` (equally sensitive) uses `ProtectedRoute roles={['OWNER']}`.
3. The `EmployeesPage` itself only hides the "add" button for SALES but makes no check before rendering the data table for non-permitted roles — it relies entirely on the API 403 path.

**Comparison**: `/contacts` also lacks a route-level role guard, but contacts are accessible to ALL roles (controller has `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')`). Employees are restricted to `OWNER` + `ACCOUNTANT` only — so the contacts pattern is not applicable here.

---

### 🟡 Warning (should fix)

#### W1 — `parseFloat()` for salary input sent to backend

**Files**:
- `apps/web/src/components/employees/EditEmployeeDialog.tsx:95`
- `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx:323`

```tsx
// Current:
baseSalary: form.baseSalary ? parseFloat(form.baseSalary) : undefined,

// Better (preserves precision):
baseSalary: form.baseSalary ? form.baseSalary.trim() : undefined,
// + change ProvisionEmployeeInput.baseSalary to string | undefined
// + in service: new Prisma.Decimal(dto.baseSalary) (already there)
```

The frontend sends `baseSalary` as a JavaScript `number` (float64). For realistic Thai salary ranges (15,000–200,000 THB) this doesn't lose precision, but the backend service already accepts a number DTO and wraps it in `new Prisma.Decimal(dto.baseSalary)` at `employees.service.ts:44` and `:117`. The service comment says `// Decimal → string in JSON; FE parseFloat` — this is a deliberate design choice. The risk is low for the salary range involved but it introduces a float round-trip in the data path. Passing the raw string from the `<Input>` directly and accepting `string` in the DTO would be cleaner.

**Severity reasoning**: Not a correctness bug for current salary ranges; the service corrects the float on write via `Prisma.Decimal`. Flagged as Warning only.

#### W2 — FINANCE_MANAGER asymmetry on employees endpoints

**File**: `apps/api/src/modules/employees/employees.controller.ts`

```ts
@Get('pickable')
@Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')  // ← FM can call pickable
pickable(@Query('search') search?: string) { ... }

@Get()
@Roles('OWNER', 'ACCOUNTANT')  // ← FM cannot list employees
list(@Query() dto: ListEmployeesDto) { ... }
```

FINANCE_MANAGER is granted the `pickable` endpoint (used in payroll form) but excluded from the `list`, `findOne`, `provision`, `update`, and `remove` endpoints. This is likely intentional (FM only picks employees for payroll, not manages them), but it is not documented in the controller. A comment explaining the asymmetry would prevent a future dev from "fixing" it incorrectly.

**Additionally**: The `menu.ts` does not add an employees menu entry for FINANCE_MANAGER, so FM users cannot navigate there. The route-level gap in C1 means FM could still reach `/employees` by URL, but the `GET /employees` API will 403 them before any data is shown.

#### W3 — `EmployeesPage` fires API query unconditionally for all roles

**File**: `apps/web/src/pages/EmployeesPage.tsx:606`

```tsx
const { data, isLoading, isError, error, refetch } = useQuery({
  queryKey: employeeKeys.list({ search: debounced || undefined, page }),
  queryFn: () => employeesApi.list({ search: debounced || undefined, page }),
  // No `enabled` guard based on role
});
```

A SALES or BRANCH_MANAGER user who navigates to `/employees` (before C1 is fixed) will trigger a 403 API call, which React Query surfaces as an error. `QueryBoundary` shows a retry button. This is noisy and confusing. Adding `enabled: canManage` (or at least checking the role before rendering) would prevent the pointless 403 and show a proper "Access Denied" message.

---

### 🔵 Info

#### I1 — Backfill CLI safety guards are good

`backfill-payroll-user-fk.cli.ts` has solid production guards:
- `EXPECTED_DB_NAME` env check with `SELECT current_database()` (parameterized template literal — not injectable)
- `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` for prod
- Dry-run default (requires `--apply`)
- Idempotent via `updateMany where: { userId: null }` guard
- Audit row count cross-check for tier-2 links

No action needed.

#### I2 — `$queryRaw` usage is safe

The only `$queryRaw` in the new code (`SELECT current_database()`) uses a tagged template literal with no user input interpolated. Safe.

#### I3 — Prisma schema follows conventions

`EmployeeProfile` model has:
- `id String @id @default(uuid())` ✅
- `createdAt`, `updatedAt`, `deletedAt` ✅
- `baseSalary Decimal @db.Decimal(12, 2)` ✅
- `@@index([deletedAt])` ✅
- Soft-delete pattern in all service queries ✅

#### I4 — Tests present and reasonable

- `EmployeesPage.test.tsx` covers list rendering, RBAC button visibility, and dialog open
- `backfill-payroll-user-fk.cli.spec.ts` covers pure `resolvePayrollMatch()` function
- No E2E tests for the employee flow yet (noted as acceptable for initial PR)

---

## Recommendation

### `feat/employee-master` (backend only)
**APPROVE** — Controller guards, DTOs, service logic, and Prisma schema all follow project conventions. No critical issues.

### `feat/employee-master-ui` (frontend)
**BLOCK** — C1 must be fixed before merge. The missing `ProtectedRoute roles` wrapper on `/employees` is the only blocker; fix is a 4-line change in `App.tsx`. W1–W3 should be addressed before merge but do not constitute blockers on their own if C1 is resolved.

### `feat/payroll-backfill` (CLI)
**APPROVE** (after `feat/employee-master` and `feat/employee-master-ui` are merged) — CLI code is well-guarded and idempotent. No critical issues.

---

## Required Fix for C1

```tsx
// apps/web/src/App.tsx, replace line 497:

// BEFORE:
<Route path="/employees" element={<EmployeesPage />} />

// AFTER:
<Route
  path="/employees"
  element={
    <ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>
      <EmployeesPage />
    </ProtectedRoute>
  }
/>
```

*Generated by Pre-Merge Guard — 2026-06-14*
