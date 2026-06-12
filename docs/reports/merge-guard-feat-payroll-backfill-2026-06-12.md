# Merge Guard Report — feat/payroll-backfill
**Date:** 2026-06-12  
**Branch:** `origin/feat/payroll-backfill`  
**Author:** Akenarin Kongdach  
**Recommendation:** ⚠️ **REVIEW** — 2 Warnings must be addressed before merge

---

## Scope

This branch is the top of a stacked PR set (PRs A–D) for the Employee Master epic.
Commits reviewed (from base `696964e7` — feat/canned-response):

| Commit | Description |
|--------|-------------|
| `55cd8878` | PR-A — Employee Master backend (EmployeeProfile model + employees module) |
| `45263a3f` | PR-B — Employee Master frontend (/employees page + route) |
| `ad1eb849` | PR-C — PayrollLine → User FK + server-derived snapshot |
| `1c60c048`–`b92ecc24` | PR-D — Backfill CLIs (employee-profiles + payroll-user-fk) |

**Files changed (epic total):** ~46 new/modified TS/TSX files in scope for review.

---

## File Changes Summary

**New backend:**
- `apps/api/src/modules/employees/` — controller, service, 3 DTOs, module
- `apps/api/src/modules/sso-config/sso-config.controller.ts` — new `GET /sso-config/effective` endpoint
- `apps/api/src/cli/backfill-employee-profiles.cli.ts` (+spec)
- `apps/api/src/cli/backfill-payroll-user-fk.cli.ts` (+spec)
- `apps/api/prisma/migrations/` — 2 new migrations (EmployeeProfile + PayrollLine.userId FK)

**New frontend:**
- `apps/web/src/pages/EmployeesPage.tsx`
- `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx`
- `apps/web/src/components/employees/EditEmployeeDialog.tsx`
- `apps/web/src/components/employees/EmployeeCombobox.tsx`
- `apps/web/src/lib/api/employees.ts`

---

## Issues Found

### ⚠️ Warning — Missing ProtectedRoute roles on /employees

**File:** `apps/web/src/App.tsx:497`

```tsx
// CURRENT (no role restriction):
<Route path="/employees" element={<EmployeesPage />} />

// EXPECTED (consistent with sensitive pages):
<Route path="/employees" element={
  <ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>
    <EmployeesPage />
  </ProtectedRoute>
} />
```

The route is nested under the global `<ProtectedRoute><MainLayout /></ProtectedRoute>` wrapper so unauthenticated access is blocked, but there is no role restriction. The backend `employees.controller.ts` correctly gates all endpoints to `OWNER` and `ACCOUNTANT`, so a `SALES` or `BRANCH_MANAGER` user would get a 403 from the API — but they would still see the page skeleton and a confusing empty/error state.

Pattern reference: `/branches` uses `<ProtectedRoute roles={['OWNER']}>`, `/chatbot-finance/*` uses `<ProtectedRoute roles={[...]}>`. Sensitive PII pages should follow this pattern.

---

### ⚠️ Warning — `@IsString()` instead of `@IsUUID()` on `PayrollLineInput.userId`

**File:** `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts`

```ts
// CURRENT:
@IsString()
@IsOptional()
userId?: string;

// EXPECTED:
@IsUUID(undefined, { message: 'รูปแบบ userId ไม่ถูกต้อง' })
@IsOptional()
userId?: string;
```

`userId` is a FK to `User.id` (UUID). Using `@IsString()` accepts any non-empty string. The service validates by DB lookup (`employeeProfile.findMany({ where: { userId: { in: linkedUserIds } } })`), so a non-UUID string would simply fail to find a match and throw `BadRequestException`. Not exploitable, but `@IsUUID()` provides early rejection with a clearer error message and is consistent with other UUID FK fields across the codebase (e.g. `contacts.dto.ts`, `CreateEmployeeDto.userId` uses `@IsUUID()`).

---

### ℹ️ Info — `AuditService` instantiated with DI cast in CLI

**File:** `apps/api/src/cli/backfill-payroll-user-fk.cli.ts:208`

```ts
const audit = new AuditService(prisma as unknown as PrismaService);
```

The CLI is a standalone Node script (not NestJS context) and cannot use the DI container. The comment at F2 justifies the cast — `AuditService` only uses the Prisma client interface, not NestJS-specific features. This is acceptable for a one-time backfill CLI, but if `AuditService` ever grows additional DI dependencies (e.g. `ConfigService`), this cast will silently fail at runtime. Low risk for a one-shot CLI.

---

### ℹ️ Info — Search filter on `employees.service.ts:list()` doesn't include `user.deletedAt: null`

**File:** `apps/api/src/modules/employees/employees.service.ts` (list method)

```ts
if (dto.search) {
  where.user = {
    OR: [
      { name: { contains: dto.search, mode: 'insensitive' } },
      { nickname: { contains: dto.search, mode: 'insensitive' } },
      { employeeId: { contains: dto.search, mode: 'insensitive' } },
    ],
    // Missing: deletedAt: null, isActive: true
  };
}
```

When `search` is provided, the nested `user` filter does not constrain on `user.deletedAt: null` or `user.isActive: true`. The profile-level `deletedAt: null` is always applied, so deleted profiles are excluded. However, a user that has been soft-deleted independently of their profile could appear. Compare to `provisionable()` which explicitly sets `deletedAt: null, isActive: true` on the user filter. Defensive hardening only.

---

## Checks Passed ✅

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on EmployeesController class | ✅ |
| `@Roles()` on every controller method | ✅ |
| `@UseGuards(JwtAuthGuard, RolesGuard)` on SsoConfigController class | ✅ |
| `@Roles()` on `GET /sso-config/effective` | ✅ |
| `Prisma.Decimal` for `baseSalary` in service (not `Number()`) | ✅ |
| `deletedAt: null` in all primary queries | ✅ |
| Soft delete via `deletedAt: new Date()` | ✅ |
| DTO validation decorators with Thai messages | ✅ |
| Frontend uses `api.get()`/`api.post()` from `@/lib/api` | ✅ |
| `useQuery`/`useMutation` from @tanstack/react-query | ✅ |
| `queryClient.invalidateQueries()` after mutations | ✅ |
| `useDebounce` on search input | ✅ |
| `React.lazy()` on EmployeesPage | ✅ |
| `$queryRaw` uses tagged template literals (SQL injection safe) | ✅ |
| No hardcoded secrets or API keys | ✅ |
| Backfill CLIs guarded by `EXPECTED_DB_NAME` + `ALLOW_PROD_BACKFILL` | ✅ |
| Backfill CLIs are idempotent (`updateMany({ where: { userId: null } })`) | ✅ |
| TypeScript `any` usage — none found in new files | ✅ |

---

## Recommendation

**⚠️ REVIEW** — Two Warnings should be fixed before merge:

1. **Add `ProtectedRoute roles` to `/employees`** in `App.tsx` — 1-line fix.
2. **Change `@IsString()` to `@IsUUID()` on `PayrollLineInput.userId`** in the payroll DTO — 1-line fix.

Neither is a security vulnerability (backend guards enforce access), but both are inconsistencies with established project patterns. Once fixed, this branch is clean to merge.
