# Pre-Merge Guard Report — 2026-06-12

**Reviewed by**: Pre-Merge Guard agent  
**Date**: 2026-06-12  
**Total unmerged branches**: 362  
**Branches reviewed**: 3 (most recently active, excluding guard/watchdog branches)

---

## Branch 1: `fix/ci-pre-existing-test-failures`

**Commits ahead of main**: 178  
**Files changed**: 611  

### Critical
None identified.

### Warning
- Large service consolidations across 5+ files with 1000–2600 line additions each merit careful human review for refactoring completeness:
  - `expense-documents.service.ts` (+2604 lines)
  - `payments.service.ts` (+2032 lines)
  - `accounting.service.ts` (+2073 lines)
  - `overdue.service.ts` (+1653 lines)
  - `paysolutions.service.ts` (+1855 lines)
- `apps/api/e2e/jest-e2e.json`: `approval-workflow.e2e-spec.ts` excluded from CI (incomplete DI harness filed as #1192); approval flow confirmed working in production per commit message — not a blocker but should be tracked.

### Info
- 27 test files deleted as part of the refactoring effort; all tracked in commit history, no orphaned dead code found.
- 3 pre-existing test failures fixed: `contract-signing-workflow.spec` (missing DI mock methods), `env-validation.spec` (stale `ENCRYPTION_KEY` tests after 2FA removal in #1169).
- New controller endpoints in `accounting.controller.ts` (`@Get period-status`, `@Post close-period`) properly decorated with `@Roles` and `@UseGuards`.
- `Prisma.Decimal` used correctly for financial fields in all new/modified code reviewed.
- `deletedAt: null` confirmed in production queries sampled across `accounting.service.ts`.
- `CODE_REVIEW_REPORT.md` added (472 lines) — no Critical or High issues documented.

### Recommendation: **REVIEW**
> Large-scope refactoring (611 files, 178 commits) with no blocking security issues. Requires human review of consolidated service logic for correctness, but safe to proceed to staged review/testing.

---

## Branch 2: `feat/payroll-backfill`

**Commits ahead of main**: 65  
**Files changed**: 190  

### Critical
- **`apps/api/src/modules/employees/dto/create-employee.dto.ts`** — `baseSalary` field uses `@IsNumber({ maxDecimalPlaces: 2 })` backed by a JavaScript `number` type. **Must use `Prisma.Decimal`** per project money-field rules (`@db.Decimal(12, 2)`). JavaScript `number` is IEEE 754 float and will cause precision loss on salary values. This is the same class of bug fixed in v2 hardening (Commission Decimal precision PR #432).

### Warning
None identified.

### Info
- `EmployeesController`: All methods properly guarded with `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles` decorators — no access control gaps.
- Backfill CLIs (`backfill-payroll-user-fk`, `backfill-expense-vendor-fk`, `backfill-employee-profiles`): All `$queryRaw` uses are parameterized via tagged template literals (safe from SQL injection). Idempotent design with DB-name guard and production confirmation requirement.
- All new DTOs include Thai validation messages.
- All new Prisma queries include `deletedAt: null`.
- Asset module new endpoints (`:id/receipt.pdf`, `vendor-names`) properly gated with `@Roles` and `@UseGuards`.

### Recommendation: **BLOCK**
> Do not merge until `baseSalary` in `CreateEmployeeDto` is changed from `@IsNumber` + `number` to `Prisma.Decimal`. This is a financial precision violation matching the pattern hardened in v2 (Commission Decimal bug). Fix is a one-line type change + DTO update.

---

## Branch 3: `feat/payroll-employee-link`

**Commits ahead of main**: 164  
**Files changed**: 483  

### Critical
None identified.

- All new controllers verified to have `@UseGuards(JwtAuthGuard)` at class level: `TwoFactorController`, `AccountingController`, `ReportsController`, `CrmController`, `ShopReviewsController` (POST; GET intentionally public), `ShopInstallmentApplyController` (intentionally public, documented).
- No `Number()` on financial Prisma Decimal fields in new code.
- No unparameterized `$queryRaw` in new code.
- No hardcoded secrets or API keys.

### Warning
- 18+ instances of `any` type in TypeScript, primarily in error handlers and contract payload destructuring across `apps/api/src/modules/accounting` and `apps/api/src/modules/contracts`. Pragmatic/acceptable cases (catch blocks, JSON payloads), but worth narrowing where possible.

### Info
- 2FA (TOTP authenticator) added with proper encryption.
- Financial reporting significantly expanded (P&L, Balance Sheet, Cash Flow).
- `CreateContactModal` refactored to remove address form coupling (reduced complexity).
- New system configuration queries intentionally omit `deletedAt` (correct for `SystemConfig` records).

### Recommendation: **APPROVE**
> Strong security posture. All protected endpoints properly guarded. Financial Decimal handling correct. No blocking issues. The `any` usages are minor and isolated to error boundaries.

---

## Summary Table

| Branch | Commits | Files | Critical | Warning | Recommendation |
|--------|---------|-------|----------|---------|----------------|
| `fix/ci-pre-existing-test-failures` | 178 | 611 | 0 | 2 | REVIEW |
| `feat/payroll-backfill` | 65 | 190 | 1 | 0 | **BLOCK** |
| `feat/payroll-employee-link` | 164 | 483 | 0 | 1 | APPROVE |

### Required Action Before Merging `feat/payroll-backfill`

In `apps/api/src/modules/employees/dto/create-employee.dto.ts`, change `baseSalary` from:

```ts
@IsNumber({ maxDecimalPlaces: 2 })
baseSalary: number;
```

To use `Prisma.Decimal` type with the standard money-field schema annotation:

```prisma
baseSalary Decimal @db.Decimal(12, 2)
```

And in the DTO, accept it as a string and transform to Decimal, or use `@Transform` decorator consistent with the pattern in other financial DTOs in the codebase.
