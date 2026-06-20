# Pre-Merge Guard Report — Employee Master Feature Stack

**Date**: 2026-06-20  
**Reviewer**: Automated Pre-Merge Guard  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>

---

## Branches Reviewed (stacked, oldest → newest)

| Layer | Branch | Commits unique to layer | Files changed |
|-------|--------|------------------------|---------------|
| PR-A+B | `feat/employee-master-ui` | ~6 | 8 files, +1 429 |
| PR-A+B+C | `feat/payroll-employee-link` | ~10 | 40 files, +5 372 / -31 |
| PR-A+B+C+D | `feat/payroll-backfill` | 4 | 28 files, +3 425 / -31 |

These three branches form a stacked PR series. The base (PR-A) is likely already in `feat/employee-master-ui`; `feat/payroll-employee-link` adds the payroll-link layer (PR-C); `feat/payroll-backfill` adds the one-time backfill CLIs (PR-D).

---

## What Changed

### PR-B — Employee Master Frontend (`feat/employee-master-ui`)
- New page: `apps/web/src/pages/EmployeesPage.tsx` + route `/employees`
- New dialogs: `ProvisionEmployeeDialog`, `EditEmployeeDialog`
- New API client: `apps/web/src/lib/api/employees.ts`
- Route added to `App.tsx` with `React.lazy()` (correct)

### PR-A+C — Payroll Employee Link (`feat/payroll-employee-link`)
- New NestJS module: `apps/api/src/modules/employees/` (controller + service + 3 DTOs)
- New Prisma model: `EmployeeProfile` (1:1 with `User`) + migration
- New Prisma FK: `PayrollLine.userId` nullable + `SET NULL` on delete + migration
- New enum: `EmploymentType { MONTHLY, DAILY, CONTRACT }`
- New controller endpoint: `GET /sso-config/effective` (returns period-effective SSO ceiling)
- Frontend: `EmployeeCombobox`, `PayrollLinesSection` updated to use picker
- Module registered in `app.module.ts` ✓, `SsoConfigModule` controller wired ✓

### PR-D — Backfill CLIs (`feat/payroll-backfill`)
- New CLI: `backfill-employee-profiles.cli.ts` — provisions `EmployeeProfile` for users without one
- New CLI: `backfill-payroll-user-fk.cli.ts` — links legacy `PayrollLine.userId` via taxId/name matching
- 8 unit tests for pure-logic functions

---

## Security Checks

### Guards & Roles
- `EmployeesController`: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
- All 5 methods have `@Roles()` decorators ✓:
  - `list`, `findOne`, `provision`, `update`, `remove` → `OWNER, ACCOUNTANT`
  - `pickable` → `OWNER, ACCOUNTANT, FINANCE_MANAGER`
  - `provisionable` → `OWNER, ACCOUNTANT`
- `SsoConfigController`: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓, `effective` → `OWNER, BM, FM, ACCOUNTANT` ✓

### Money Fields
- `EmployeeProfile.baseSalary` → `Decimal @db.Decimal(12, 2)` ✓
- `EmployeesService.provision/update` → `new Prisma.Decimal(dto.baseSalary)` ✓
- No raw `Number()` on monetary Prisma fields in backend ✓
- `PayrollLine.baseSalary`, `ssoEmployee`, `whtAmount` — existing Decimal fields, unchanged ✓

### Soft Delete
- All `employeeProfile` queries include `where: { deletedAt: null }` ✓
- `remove()` uses `update({ data: { deletedAt: new Date() } })` ✓
- `pickable()` additionally checks `resignedDate` and `user.isActive` ✓
- `provisionable()` includes `deletedAt: null` on User ✓

### SQL Injection
- `$queryRaw` usage in both backfill CLIs: `` `SELECT current_database()` `` — static template literal, no user input interpolated ✓
- All other queries use Prisma parameterized API ✓

### PII
- `employees.service.ts::list()` masks `nationalId` → `•••••••••XXXX` ✓
- `provisionable()` explicitly excludes `nationalId` from select projection ✓
- Backfill CLI PR-D: tier-2 name-linked rows emit `PAYROLL_FK_MATCHED_BY_NAME` audit log ✓

### Secrets / Hardcoded Values
- No hardcoded secrets or API keys found ✓

---

## Issues Found

### Warning — Native `<select>` element in ProvisionEmployeeDialog

**File**: `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx`  
**Rule**: `.claude/rules/frontend.md` — "ใช้ shadcn/ui components + Radix UI primitives"

The Employment Type field uses a native HTML `<select>` element instead of shadcn/ui `<Select>`:

```tsx
<select
  value={employmentType}
  onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
  className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
>
```

Functionally works, but breaks visual consistency. A native `<select>` uses system OS styling on mobile (especially on Android), doesn't respect the app's design tokens on all browsers, and has no dark-mode story.

**Fix**: Replace with shadcn `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>`.

---

### Warning — `parseFloat()` on Decimal string values in frontend pre-fill

**File**: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`

```ts
const base = emp.baseSalary != null ? parseFloat(emp.baseSalary) : NaN;
const ceiling = ssoCfg.data ? parseFloat(ssoCfg.data.salaryCeiling) : null;
const rate = ssoCfg.data?.rate ?? 0.05;
if (emp.ssoEligible && !Number.isNaN(base) && ceiling != null) {
  patch.ssoEmployee = String(round2(Math.min(base, ceiling) * rate));
}
```

This is **UI-only pre-fill** — the server recalculates from scratch on save using `Prisma.Decimal`, so no financial precision is persisted via this code path. The risk is a subtly wrong pre-filled SSO amount shown to the user (e.g., 8333.33 × 0.05 via float arithmetic can give 416.66649... → `round2` → 416.67, same as Decimal in this case). However, float arithmetic on amounts like 15,000.01 THB could in theory deviate by ±0.01 THB in the pre-fill.

**Recommended fix** (optional — low risk since server is authoritative): Use integer arithmetic for SSO pre-fill:
```ts
const baseCents = Math.round(parseFloat(emp.baseSalary ?? '0') * 100);
const ceilCents = Math.round(parseFloat(ssoCfg.data.salaryCeiling) * 100);
const ssoCents = Math.round(Math.min(baseCents, ceilCents) * rate);
patch.ssoEmployee = String(ssoCents / 100);
```

---

### Info — `/employees` route not wrapped in `ProtectedRoute roles={[...]}`

**File**: `apps/web/src/App.tsx`

```tsx
<Route path="/employees" element={<EmployeesPage />} />
```

This follows the same pattern as `/customers` and `/contacts` (no role restriction at route level). Any authenticated user can navigate to `/employees` — they'll get a 403 from the API and see the `QueryBoundary` error state rather than being redirected to `/`. The page itself guards the action buttons with `canManage`, but the list call will still 403 for SALES/BM.

This is a UX issue, not a security issue (the API is the real enforcement point). However, adding `ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}` would give a cleaner "unauthorized" redirect instead of a broken error page.

---

### Info — Thai validation messages missing on some optional DTO fields

**File**: `apps/api/src/modules/employees/dto/create-employee.dto.ts`

Several `@IsOptional()` string fields lack a Thai message option:
```ts
@IsOptional()
@IsString()
position?: string;  // no message: '...'
```

Low priority since these are optional free-text fields and the default class-validator message is passable. The key validators (`userId`, `baseSalary`, `employmentType`) already have Thai messages.

---

### Info — Large plan documents committed to `docs/`

**Files**: 
- `docs/specs/2026-06-04-employee-master-prC-payroll-link.md` (1428 lines)
- `docs/specs/2026-06-04-employee-master-prD-backfill.md` (670 lines)

These are implementation planning docs, consistent with prior practice in this repo. Not a code issue.

---

## Summary

| Severity | Count | Blocking? |
|----------|-------|-----------|
| Critical | 0 | — |
| Warning | 2 | No |
| Info | 3 | No |

---

## Recommendation: REVIEW (not blocked)

No critical security, correctness, or financial precision issues found. The Employee Master stack is well-structured:
- Guards and roles are complete on all controller methods
- Soft-delete patterns are correct
- PII is masked at the list endpoint
- Prisma.Decimal is used for all monetary backend operations
- Backfill CLIs have dry-run mode, DB name guard, and prod-confirmation gate

**Action required before merge**:
1. Replace native `<select>` in `ProvisionEmployeeDialog` with shadcn `<Select>` (Warning)
2. Decide whether to keep `parseFloat()` for SSO pre-fill or switch to integer arithmetic (Warning — low risk since server is authoritative)

Both can be addressed in a follow-up commit to `feat/payroll-backfill` without blocking the merge.
