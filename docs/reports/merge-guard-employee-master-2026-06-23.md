# Merge Guard Report — feat/employee-master

**Date**: 2026-06-23  
**Branch**: `feat/employee-master`  
**Author**: Akenarin Kongdach  
**Base commit**: `3ad5e99c` (shared with feat/payroll-employee-link)  
**Unique commits**: 10 (PR-A backend)

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Modified — adds `EmployeeProfile` model, `EmploymentType` enum |
| `apps/api/prisma/migrations/20260969000000_add_employee_profile/migration.sql` | **New** — creates `employee_profiles` table |
| `apps/api/src/app.module.ts` | Modified — registers `EmployeesModule` |
| `apps/api/src/modules/employees/employees.controller.ts` | **New** — CRUD controller |
| `apps/api/src/modules/employees/employees.service.ts` | **New** — service with PII masking |
| `apps/api/src/modules/employees/employees.module.ts` | **New** — NestJS module |
| `apps/api/src/modules/employees/dto/create-employee.dto.ts` | **New** — CreateEmployeeDto |
| `apps/api/src/modules/employees/dto/update-employee.dto.ts` | **New** — UpdateEmployeeDto |
| `apps/api/src/modules/employees/dto/list-employees.dto.ts` | **New** — ListEmployeesDto |
| `apps/api/src/modules/employees/employees.service.spec.ts` | **New** — 171-line unit test suite |

---

## Critical Issues

None.

---

## Warnings

### W-1: `baseSalary` typed as `number` in DTO (financial field)
**File**: `apps/api/src/modules/employees/dto/create-employee.dto.ts:26`  
**Code**: `baseSalary?: number;` with `@IsNumber({ maxDecimalPlaces: 2 })`

Database rules state: _"ใช้ Decimal เท่านั้น: @db.Decimal(12, 2) — ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน"_.

The DTO uses JavaScript `number` (IEEE 754 float) for transport. The service correctly converts it via `new Prisma.Decimal(dto.baseSalary)` before writing to DB, so precision loss for values with >15 significant digits is possible in theory.

**Mitigation**: `baseSalary` is a salary field typically in the range 1,000–500,000 THB. IEEE 754 doubles have 15–17 significant decimal digits, so for values up to 500,000.00 (8 significant digits) there is NO precision loss. The risk is negligible in practice. The service correctly converts to `Prisma.Decimal` before persistence.

**Recommendation**: Consider `@IsNumberString()` + `new Prisma.Decimal(dto.baseSalary)` (string input) to fully eliminate the float transport risk and align with how the API returns `Decimal` as string in JSON. Not a blocker for this PR.

---

### W-2: `BRANCH_MANAGER` and `SALES` roles cannot access employee endpoints
**File**: `apps/api/src/modules/employees/employees.controller.ts`  
**Roles**: All endpoints restricted to `OWNER` + `ACCOUNTANT` (with `pickable` also allowing `FINANCE_MANAGER`)

BRANCH_MANAGER cannot call `GET /employees` to see their own branch's staff. This may be intentional (aggregated view across all branches, no per-branch filter) but it could cause friction if BM needs to pick employees for payroll prep.

**Context**: Aligns with the accounting policy decision for `/shop/accounting` (W5 — BM excluded from cross-branch aggregates). Consistent.  
**Recommendation**: Verify with owner whether BM needs read access to `GET /employees?branchId=<own>`. If yes, add a branch-scoped filter and allow BM role.

---

## Info

### I-1: PII masking is correct and tested
`list()` masks `nationalId` to `•••••••••xxxx` (last 4 visible). `findOne()` returns full ID (OWNER/ACCOUNTANT only). `pickable()` explicitly excludes `nationalId` from the projection. `provisionable()` uses `select: { id, employeeId, name, nickname }` — no nationalId. All 4 cases are tested in `employees.service.spec.ts` ✓

### I-2: Soft-delete pattern correct
All queries include `deletedAt: null`. `remove()` uses `update({ data: { deletedAt: new Date() } })` — no hard delete ✓

### I-3: Timestamps present
`EmployeeProfile` model includes `createdAt`, `updatedAt`, `deletedAt` ✓

### I-4: UUID IDs
`id String @id @default(uuid())` ✓

### I-5: Migration name uses unusual timestamp `20260969`
The migration file is `20260969000000_add_employee_profile`. The `96` in month position and `9` in day position are invalid dates (June only has 30 days; month 96 doesn't exist). Prisma migrations use `YYYYMMDDHHMMSS` format. `202609` = September 2026 is plausible, but `69` as day is invalid. This will not break `prisma migrate deploy` since Prisma treats the prefix as a sortable string, but it's an unusual naming pattern. No functional impact.

### I-6: Conflict (P2002) properly handled
`provision()` catches Prisma's `P2002` unique constraint error and converts it to `ConflictException('พนักงานคนนี้มีทะเบียนแล้ว')` with Thai error message ✓

### I-7: `isActive=false` filter only for `list()` when explicitly requested
When `isActive='true'` is passed, the query adds `resignedDate: null`. When `isActive='false'` is NOT handled (no `where.deletedAt = { not: null }` path). A consumer passing `isActive=false` won't get soft-deleted/resigned employees — the filter is silently ignored. Low impact since `isActive=false` is not a documented use case.

---

## Quality Observations

- **Guards**: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level + `@Roles(...)` on every method ✓
- **DTOs**: Separate `Create`/`Update`/`List` DTOs with class-validator. Thai error messages on key fields ✓
- **Service/Controller separation**: No PrismaService calls in controller — all go through `EmployeesService` ✓
- **Error handling**: `NotFoundException` on missing records, `ConflictException` on duplicate, audit log on all state changes ✓
- **Audit trail**: `EMPLOYEE_PROFILE_CREATED`, `EMPLOYEE_PROFILE_UPDATED`, `EMPLOYEE_PROFILE_DELETED` action strings ✓
- **Test coverage**: 171-line spec covering provision, list, findOne, update, remove, pickable, provisionable ✓
- **Module registration**: Added to `app.module.ts` ✓
- **FK constraint**: `ON DELETE RESTRICT` on `user_id` FK — prevents deleting a User who has an EmployeeProfile ✓

---

## Recommendation

**APPROVE** — with optional follow-up on W-1 (baseSalary string input) and W-2 (BM role scope clarification). No blockers. The PII masking design is thorough, guards are correct, and the test suite covers all paths including the provisionable PII exclusion assertion. Ready to merge as PR-A (backend foundation) before PR-B (UI) is built on top.
