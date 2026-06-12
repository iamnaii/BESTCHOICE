# Merge Guard Report — feat/employee-master

**Date**: 2026-06-12  
**Branch**: `feat/employee-master`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main** (unique): ~15 commits  
**Key PRs included**: PR-A (backend module), PR-D (backfill CLIs)

---

## File Changes Summary

| Area | Files |
|------|-------|
| Prisma schema | `apps/api/prisma/schema.prisma` (EmployeeProfile model) |
| API module | `apps/api/src/modules/employees/` (controller, service, 3 DTOs, module) |
| CLI scripts | `apps/api/src/cli/backfill-employee-profiles.cli.ts`, `backfill-payroll-user-fk.cli.ts` |
| App module | `apps/api/src/app.module.ts` (EmployeesModule registration) |
| Tests | `apps/api/src/cli/backfill-employee-profiles.cli.spec.ts`, `backfill-payroll-user-fk.cli.spec.ts`, `employees.service.spec.ts` |

---

## Issues Found

### Critical — None

All checklist items pass:
- ✅ `@UseGuards(JwtAuthGuard, RolesGuard)` on controller class level
- ✅ `@Roles()` decorator on every method (OWNER / ACCOUNTANT; FINANCE_MANAGER on `pickable`)
- ✅ All `findMany`/`findFirst` queries include `deletedAt: null`
- ✅ `baseSalary` stored and handled as `Prisma.Decimal` (no `Number()` cast on money)
- ✅ No hardcoded secrets
- ✅ No unparameterized `$queryRaw` — both backfill CLIs use tagged template literals or `Prisma.sql`

### Warning — 1

**`pickable()`: `where.user` overwritten when `search` is provided**  
File: `apps/api/src/modules/employees/employees.service.ts` (lines 162–172)

When `search` is provided, `where.user` is **replaced** entirely. The replacement correctly re-includes `isActive: true` and `deletedAt: null` on the User side, so the effective filter is safe. However the pattern is fragile: a future developer editing the base `where.user` clause would need to duplicate the change in the search branch. Recommend merging both into a single `where.user` construction:

```ts
const userFilter = {
  isActive: true,
  deletedAt: null,
  ...(search ? { OR: [...] } : {}),
};
where.user = { is: userFilter };
```

**`provisionable()`: `where.OR` clobbers `isSystemUser`/`isActive` filter when `search` set**  
File: `apps/api/src/modules/employees/employees.service.ts` (lines 204–213)

`where.OR = [...]` adds an OR block at the top of the User filter. Because the non-OR conditions (`isSystemUser`, `isActive`, `deletedAt`) are separate keys on the same `where` object (not inside `AND`), Prisma treats them as `AND (isSystemUser=false) AND (isActive=true) AND (deletedAt=null) AND (OR[...])`. This is **correct** behavior per Prisma semantics — but worth noting it depends on Prisma's implicit AND semantics rather than being explicit.

### Info

- `backfill-payroll-user-fk.cli.ts` imports `PrismaService` and `AuditService` from the NestJS module path but instantiates a raw `PrismaClient` for the actual DB work. The NestJS imports appear unused in the CLI body — safe but adds dead import noise. Verify with `tsc --noUnusedLocals`.
- `EmployeeProfile` model correctly has `createdAt`, `updatedAt`, `deletedAt` — compliant with database rules.
- `baseSalary @db.Decimal(12, 2)` — correct money field type.
- Index on `deletedAt` present — good for soft-delete query performance.

---

## Recommendation: **APPROVE**

The Employee Master backend is clean. Security guards and role gates are correct, money fields use `Decimal`, soft-delete filters are in place, and backfill CLIs have proper prod safeguards (`EXPECTED_DB_NAME`, `ALLOW_PROD_BACKFILL`, 5-second abort window). The one warning (fragile `where.user` override pattern) is a code-hygiene issue, not a security or correctness bug.

> **Note**: This branch diverges from `feat/payroll-backfill`. Both add the Employee Master; `feat/payroll-backfill` additionally includes the Employee Master UI (PR-B) and payroll-employee FK link (PR-C). If both are intended for merge, they should be rebased onto each other or merged sequentially. See separate report for `feat/payroll-backfill`.
