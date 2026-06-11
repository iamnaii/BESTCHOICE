# Pre-Merge Guard Report — Employee Master Stack

**Date**: 2026-06-11  
**Reviewer**: Pre-Merge Guard (automated)  
**Author**: Akenarin Kongdach  
**Branches reviewed** (stacked PRs, newest first):

| Layer | Branch | Commits |
|-------|--------|---------|
| PR-D | `feat/payroll-backfill` | 3 commits |
| PR-C | `feat/payroll-employee-link` | 9 commits |
| PR-B | `feat/employee-master-ui` | 6 commits |

> PR-A (`feat/employee-master` — backend EmployeeProfile model + CRUD) is the base and was not independently reviewed in this pass as it was already merged into the PR-B layer.

---

## File Changes Summary

### PR-B: Frontend Employee Master Page
```
apps/web/src/App.tsx                                   |   2 +
apps/web/src/components/employees/EditEmployeeDialog.tsx  | 225 +
apps/web/src/components/employees/ProvisionEmployeeDialog.tsx | 200 +
apps/web/src/config/menu.ts                            |   2 +
apps/web/src/lib/api/employees.ts                      |  85 +
apps/web/src/pages/EmployeesPage.tsx                   | 131 +
apps/web/src/pages/__tests__/EmployeesPage.test.tsx    | 104 +
```

### PR-C: Payroll-Employee Link + SSO Config endpoint
```
apps/api/prisma/schema.prisma                          |  38 +  (PayrollLine.userId FK + EmployeeProfile)
apps/api/src/modules/employees/employees.controller.ts |  66 +
apps/api/src/modules/employees/employees.service.ts    | 221 +
apps/api/src/modules/employees/dto/                    |  88 +  (3 DTOs)
apps/api/src/modules/sso-config/sso-config.controller.ts |  32 +
apps/api/src/modules/expense-documents/expense-documents.service.ts | 88 +/-
apps/web/src/components/employees/EmployeeCombobox.tsx | 124 +
apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx |  57 +/-
```

### PR-D: Backfill CLIs
```
apps/api/src/cli/backfill-employee-profiles.cli.ts     | 130 +
apps/api/src/cli/backfill-payroll-user-fk.cli.ts       | 267 +
apps/api/src/cli/backfill-employee-profiles.cli.spec.ts |  25 +
apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts  |  45 +
```

---

## Issues by Severity

### Critical — NONE FOUND ✅

All critical checks passed:

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controllers | ✅ Present on `EmployeesController` (class-level) and `SsoConfigController` (class-level) |
| `@Roles()` on every controller method | ✅ All 7 methods on EmployeesController have `@Roles()`; `SsoConfigController.effective` has `@Roles()` |
| `deletedAt: null` in all new queries | ✅ Confirmed in `employees.service.ts`: every `findMany`/`findFirst`/`count` includes `deletedAt: null` |
| `Number()` on money/financial fields | ✅ `baseSalary` correctly uses `new Prisma.Decimal(dto.baseSalary)` in service; no `Number()` on Decimal values |
| Hardcoded secrets / API keys | ✅ None found |
| Unparameterized `$queryRaw` | ✅ Only parameterized usage: `` `SELECT current_database()` `` (no user input) |

---

### Warning — 3 ITEMS

#### W1: Optional DTO fields missing Thai validation messages
**File**: `apps/api/src/modules/employees/dto/create-employee.dto.ts`  
**Severity**: Warning  
**Details**: Fields `position`, `bankName`, `bankAccountNo`, `taxIdOverride`, `note` use `@IsOptional()` + `@IsString()` but lack `{ message: '...' }` Thai error messages. The required field `userId` does have a Thai message. Optional fields rarely fail validation, but project convention requires Thai messages on all decorators.

**Suggested fix**:
```ts
@IsOptional()
@IsString({ message: 'ตำแหน่งต้องเป็นข้อความ' })
position?: string;
```

---

#### W2: Frontend `parseFloat()` on baseSalary — locale edge case
**Files**: `EditEmployeeDialog.tsx:73`, `ProvisionEmployeeDialog.tsx:92`  
**Severity**: Warning (UX, not data integrity)  
**Details**: `parseFloat(form.baseSalary)` converts the form string to number before sending to the API. This is safe for standard Thai decimal input (e.g. `15000.50`), but `parseFloat('15,000')` returns `15` silently (stops at comma). If a user types a thousands-separator the salary would be submitted as `15` with no error.  
**Note**: The API DTO uses `@IsNumber({ maxDecimalPlaces: 2 })` which would catch `15` if it fails the salary range check — but there is no minimum value guard on the field.

**Suggested fix**: Strip commas before parsing, or use a numeric input that prevents commas.

---

#### W3: `FINANCE_MANAGER` excluded from `/employees` list — confirm intentional
**File**: `apps/api/src/modules/employees/employees.controller.ts:28`  
**Severity**: Warning (role design question)  
**Details**: The `GET /employees` list is restricted to `OWNER` and `ACCOUNTANT`. `FINANCE_MANAGER` can create payroll documents and needs to pick employees via `GET /employees/pickable` (which correctly includes `FINANCE_MANAGER`), but cannot view the full employee master list. This appears intentional (HR data vs. payroll operations) but should be confirmed by the owner.

---

### Info — 3 ITEMS

#### I1: `any` in test files
**Files**: `payroll-user-link.service.spec.ts`, `EmployeesPage.test.tsx`, `EmployeeCombobox.test.tsx`  
**Details**: Test mocks use `as any` / `let prisma: any` for mock objects. Standard Jest mocking pattern — acceptable in test code.

#### I2: CLI scripts use raw `PrismaClient` instead of NestJS `PrismaService`
**Files**: `backfill-employee-profiles.cli.ts`, `backfill-payroll-user-fk.cli.ts`  
**Details**: CLIs instantiate `new PrismaClient()` directly. This is expected for standalone scripts run outside the NestJS DI container. Both scripts call `prisma.$disconnect()` in a `finally` block, so no connection leak.

#### I3: Backfill CLIs do not run in production CI
**Details**: The CLIs are one-shot scripts intended for manual execution via Cloud Run Job. They are not invoked by any cron or route. No action needed — documenting for awareness.

---

## Recommendation

```
┌─────────────────────────────────────────────────────────────┐
│  RECOMMENDATION:  ✅  APPROVE (with minor notes)            │
│                                                              │
│  No Critical or blocking issues found.                       │
│  3 Warnings — none block merge; W1 and W2 are cosmetic/UX.  │
│  W3 is a role design confirmation (not a bug).              │
│                                                              │
│  Merge order: PR-A → PR-B → PR-C → PR-D (stacked)          │
└─────────────────────────────────────────────────────────────┘
```

### Pre-merge checklist
- [ ] Confirm W3: is FINANCE_MANAGER intentionally excluded from employee list?
- [ ] Optional: add Thai messages to optional DTO fields (W1)
- [ ] Optional: sanitize baseSalary input to strip commas (W2)
- [ ] Run `./tools/check-types.sh all` on the merged branch
- [ ] Run `./tools/run-tests.sh --skip-e2e` to verify API + web test suites

---

*Generated by Pre-Merge Guard agent — 2026-06-11*
