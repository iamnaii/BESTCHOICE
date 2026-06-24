# Merge Guard Report — feat/employee-master
**Date**: 2026-06-24  
**Branch**: `feat/employee-master`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Recommendation**: ⚠️ REVIEW (1 Warning, 1 Info — no blockers)

---

## Summary

New NestJS backend module: `EmployeeProfile` (1:1 with `User`). Adds CRUD, PII-safe list/pickable/provisionable endpoints. 9 unique commits. No frontend yet.

**Files changed (unique to branch):**
- `apps/api/src/modules/employees/employees.controller.ts`
- `apps/api/src/modules/employees/employees.service.ts`
- `apps/api/src/modules/employees/employees.module.ts`
- `apps/api/src/modules/employees/dto/create-employee.dto.ts`
- `apps/api/src/modules/employees/dto/update-employee.dto.ts`
- `apps/api/src/modules/employees/dto/list-employees.dto.ts`
- `apps/api/prisma/schema.prisma` (EmployeeProfile model)
- `apps/api/src/app.module.ts` (module registration)

---

## ✅ Passed Checks

| Check | Status | Notes |
|-------|--------|-------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller | ✅ | Class-level guard present |
| `@Roles()` on every endpoint | ✅ | All 7 endpoints decorated |
| `Prisma.Decimal` for money (`baseSalary`) | ✅ | `new Prisma.Decimal(dto.baseSalary)` — no `Number()` |
| `deletedAt: null` in all queries | ✅ | All `findMany`/`findFirst` include soft-delete filter |
| Soft-delete pattern | ✅ | `remove()` sets `deletedAt: new Date()` |
| DTO validation with Thai messages | ✅ | `@IsUUID`, `@IsEnum`, `@IsNumber`, `@Min` all with Thai messages |
| Module registered in `app.module.ts` | ✅ | Imported and added to `imports[]` |
| PII masking in `list()` | ✅ | `nationalId` masked to `•••••••••XXXX` |
| PII exclusion in `pickable()` / `provisionable()` | ✅ | Explicit projection excludes `nationalId` |
| No hardcoded secrets | ✅ | Clean |
| No raw `$queryRaw` | ✅ | Uses Prisma ORM only |
| Decimal schema (`@db.Decimal(12, 2)`) | ✅ | `baseSalary Decimal? @db.Decimal(12, 2)` |

---

## ⚠️ WARNING

### W1 — Bank account number logged to audit trail (PII in plaintext)

**File**: `apps/api/src/modules/employees/employees.service.ts:131`

```typescript
await this.audit.log({
  userId: actor?.userId,
  action: 'EMPLOYEE_PROFILE_UPDATED',
  entity: 'employee_profile',
  entityId: id,
  newValue: dto as Record<string, unknown>,  // ← includes bankAccountNo
  ...
});
```

`UpdateEmployeeDto` contains `bankAccountNo` which is PII. Logging the full DTO object to `AuditLog.newValue` stores the bank account number in plaintext in the database. This is inconsistent with how `provision()` at line 57 only logs `{ userId, position }`.

**Fix**: Redact `bankAccountNo` before logging:

```typescript
const { bankAccountNo: _bbn, ...auditSafeDto } = dto;
newValue: auditSafeDto as Record<string, unknown>,
```

Or log only changed field names (not values) for sensitive fields.

---

## ℹ️ INFO

### I1 — `userSelect` fetches `nationalId` on every `list()` call

**File**: `apps/api/src/modules/employees/employees.service.ts:28-30`

```typescript
private userSelect = {
  id: true, name: true, nickname: true, employeeId: true,
  nationalId: true, startDate: true, branchId: true, isActive: true,
};
```

This `userSelect` is shared between `list()` (which masks nationalId) and `findOne()` (which returns it unmasked). Every `list()` query fetches `nationalId` from the DB even though it's immediately masked. A minor improvement: define a separate `listUserSelect` (without `nationalId`) for `list()` to avoid loading PII that isn't used. This is low priority since OWNER/ACCOUNTANT roles are already required.

---

## Other Branches Reviewed

| Branch | Type | Issues | Recommendation |
|--------|------|--------|----------------|
| `feat/settings-ia-redesign-p2b` | Frontend routing migration (12 files, +653/-203 lines) | None | ✅ APPROVE |
| `feat/users-page-consolidation` | Frontend settings tab consolidation (8 files) | None | ✅ APPROVE |

Settings branches make no backend changes. All frontend patterns are correct (no raw `fetch()`, no localStorage, proper `useQuery`/`useMutation` usage confirmed by absence of violations in diff scan).

---

## Recommendation

**feat/employee-master**: `REVIEW` — merge is safe from a security standpoint (no CRITICAL issues). Fix W1 (bank account PII in audit log) before shipping to production. I1 is optional cleanup.

The module is otherwise well-written: guards are correct, Decimal is used for money, soft-delete pattern is followed, PII masking is applied on all list/search endpoints.
