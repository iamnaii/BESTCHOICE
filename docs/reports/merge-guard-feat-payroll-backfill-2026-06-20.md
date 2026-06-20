# Merge Guard Report — feat/payroll-backfill

**Date**: 2026-06-20  
**Branch**: `feat/payroll-backfill`  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local)  
**Latest commit**: `b92ecc24` — 2026-06-05  
**Commits ahead of main**: 158 (stacked: contacts/party-master → Employee Master PR-A → PR-B → PR-C → PR-D)

---

## Summary

This stacked branch introduces the Employee Master feature across 4 PRs:
- **PR-A** (`55cd8878`): `EmployeeProfile` model (1:1 User), `employees` module backend (CRUD + PII-safe pickable)
- **PR-B** (`45263a3f`): `/employees` page frontend — list, provision, edit
- **PR-C** (`ad1eb849`): `PayrollLine` → `EmployeeProfile` FK link, server-derived `taxId` snapshot
- **PR-D** (`b92ecc24`, `1c60c048`): Two backfill CLIs for historical data

The spec explicitly guards `nationalId` (PII): list returns masked (last 4 only), `findOne` (OWNER/ACCOUNTANT only) returns full. `pickable` endpoint strips `nationalId` entirely.

---

## File Changes (key new files)

| File | Change |
|------|--------|
| `modules/employees/employees.controller.ts` | 66 lines — new controller |
| `modules/employees/employees.service.ts` | 221 lines — full CRUD + PII masking |
| `modules/employees/employees.service.spec.ts` | 171 lines — test suite |
| `modules/employees/dto/*.ts` | Create/Update/List DTOs |
| `cli/backfill-payroll-user-fk.cli.ts` | 267 lines — tier-1/tier-2 matching CLI |
| `cli/backfill-employee-profiles.cli.ts` | New CLI — provision profiles from active users |
| `pages/EmployeesPage.tsx` | Frontend list/provision/edit UI |

---

## Issues Found

### Critical
_None_

### Warning

**[W-1] `/employees` route missing role restriction in `ProtectedRoute`**

In `apps/web/src/App.tsx`:
```tsx
// Line 497 — no roles prop
<Route path="/employees" element={<EmployeesPage />} />
```

The parent route wraps `<MainLayout />` in `<ProtectedRoute>` (auth-only), so unauthenticated users are blocked. However, there is no `roles={['OWNER', 'ACCOUNTANT']}` on the route itself. Any authenticated user (including `SALES`, `BRANCH_MANAGER`) can navigate to `/employees`.

**Impact**: A SALES or BRANCH_MANAGER user visiting `/employees` will:
1. See the page shell (no data — API returns 403)
2. Experience an error state that reveals the endpoint exists

**Mitigation in place**: 
- Backend API is correctly guarded: `@Roles('OWNER', 'ACCOUNTANT')` on all list/CRUD endpoints
- `EmployeesPage.tsx` internally gates management buttons via `canManage = ['OWNER', 'ACCOUNTANT'].includes(user?.role)`
- Data (including masked nationalId) will NOT be exposed to unauthorized roles

**Recommended fix**:
```tsx
<Route
  path="/employees"
  element={
    <ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>
      <EmployeesPage />
    </ProtectedRoute>
  }
/>
```

This aligns with how similar PII-sensitive pages are gated (e.g. `/suppliers/:id`, `/settings/*`).

---

### Info

- **[I-1] Money fields use `Prisma.Decimal` correctly**: `baseSalary` is created with `new Prisma.Decimal(dto.baseSalary)` in `provision()`. No `Number()` wrapping on money fields. ✓

- **[I-2] All queries include `deletedAt: null`**: `findFirst`, `findMany`, and nested `where` clauses all filter soft-deleted records. The `update` and `remove` methods call `findOne(id)` first (which enforces `deletedAt: null`), so the update's `where: { id }` is safe. ✓

- **[I-3] PII handling is correct**:
  - `list()` returns masked nationalId (`•••••••••XXXX`)
  - `findOne()` returns full nationalId (OWNER/ACCOUNTANT only via controller `@Roles`)
  - `pickable()` response explicitly excludes nationalId — projection via `select`
  - `provisionable()` response excludes nationalId — projection via `select`
  ✓

- **[I-4] Backfill CLI `$queryRaw` — safe**: The only `$queryRaw` is `SELECT current_database()` (parameterized template literal, no interpolated user input). Proper `EXPECTED_DB_NAME` guard prevents wrong-database runs. Idempotent (`userId IS NULL` guard on updateMany). ✓

- **[I-5] Backfill CLI security guards**: Production runs require `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` + correct `EXPECTED_DB_NAME`. Mirrors the pattern in `wipe-accounting.cli.ts`. ✓

- **[I-6] Frontend follows correct patterns**: `EmployeesPage.tsx` uses `useQuery`, `useMutation`, `useQueryClient`. No raw `fetch()`. `queryClient.invalidateQueries()` after mutations. ✓

- **[I-7] FINANCE_MANAGER on `pickable`**: The `GET /employees/pickable` allows `FINANCE_MANAGER` so finance staff can select employees when creating payroll. This is intentional per spec (payroll module needs the employee picker). ✓

- **[I-8] Route is under `MainLayout` auth guard**: Although no roles restriction, the `/employees` route IS inside the `<ProtectedRoute><MainLayout /></ProtectedRoute>` parent group, so it requires authentication. Unauthenticated access is blocked. ✓

---

## Recommendation

**⚠️ REVIEW**

One Warning item found. The branch is otherwise clean — correct Decimal usage, proper soft-delete patterns, PII masking done right, safe backfill CLIs. The missing `ProtectedRoute roles={...}` on `/employees` is the only gap: data won't leak (API guards are correct) but any authenticated user can visit the route and will see error states. Fix is a one-liner in `App.tsx`.

**Action required before merge**: Add `roles={['OWNER', 'ACCOUNTANT']}` to the `/employees` route's `ProtectedRoute` wrapper in `apps/web/src/App.tsx`.

---
_Generated by Pre-Merge Guard — 2026-06-20_
