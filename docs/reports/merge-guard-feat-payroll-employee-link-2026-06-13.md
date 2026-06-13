# Pre-Merge Guard Report: feat/payroll-employee-link

**Date**: 2026-06-13  
**Branch**: `origin/feat/payroll-employee-link`  
**Authors**: Akenarin Kongdach, iamnaii  
**Commits ahead of main**: 161  
**Last commit**: 2026-06-05  

---

## File Changes Summary

- **494 TypeScript/TSX files changed** vs `main`
- New modules: `two-factor` controller, `EmployeeCombobox` component, `sso-config` endpoint
- Key areas: payroll service, employees UI, auth controller (2FA endpoints), credit-check service, tax.service.ts

---

## Issues by Severity

### 🔴 CRITICAL

**C1 — `TwoFactorController` missing `RolesGuard` + `@Roles()`**  
File: `apps/api/src/modules/two-factor/two-factor.controller.ts`

New controller uses `@UseGuards(JwtAuthGuard)` at class level but omits `RolesGuard`. None of the 4 endpoints (`/2fa/enroll`, `/2fa/confirm`, `/2fa/disable`, `/2fa/backup-codes`) carry a `@Roles(...)` decorator.

Per project security rules, every controller must have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles(...)` on every method. Without `RolesGuard`, the decorator is effectively not enforced.

**Fix**: Add `RolesGuard` to class-level `@UseGuards(...)` and add `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` to each method.

---

**C2 — `Number()` on Decimal financial fields in arithmetic contexts (46+ instances)**  
Files: `accounting.service.ts`, `bank-reconciliation.service.ts`, `data-audit.service.ts`, `scheduler.service.ts`, `notifications.service.ts`, `contracts.service.ts`

Financial calculations convert `Prisma.Decimal` to JavaScript float before arithmetic — introducing precision loss that v4 hardening eliminated. Arithmetic (non-display) examples:

```ts
// accounting.service.ts
const remaining = Number(p.amountDue) - Number(p.amountPaid ?? 0);

// data-audit.service.ts
.reduce((sum, p) => sum + Number(p.amountDue) - Number(p.amountPaid), 0)

// scheduler.service.ts
const outstanding = Number(payment.amountDue) - Number(payment.amountPaid) + Number(payment.lateFee);
(sum, p) => sum + (Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee))
const amountDue = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);

// bank-reconciliation.service.ts
this.amountMatches(Number(p.amountPaid), line.amount)
```

Note: `Number().toLocaleString()` and `Number().toFixed()` for display formatting are acceptable and not flagged.

**Fix**: Use `new Prisma.Decimal(x).sub(y).add(z)` for arithmetic, `.equals()` for comparisons, `.toNumber()` only at final serialization boundary.

---

### 🟡 WARNING

**W1 — Auth controller 2FA methods missing `@Roles()`**  
File: `apps/api/src/modules/auth/auth.controller.ts`

New endpoints `@Post('2fa/generate')`, `@Post('2fa/enable')`, `@Post('2fa/disable')`, `@Get('2fa/status')` each have per-method `@UseGuards(JwtAuthGuard)` but no `@Roles(...)`. Less severe than C1 (self-service per-user operations) but inconsistent with project convention.

**W2 — `Number()` on salary/WHT fields in credit-check and tax services**  
Files: `credit-check.service.ts`, `tax.service.ts`

```ts
// credit-check.service.ts — salary for debt-to-income ratio
const customerSalary = creditCheck.customer.salary ? Number(creditCheck.customer.salary) : 0;
const monthlySalary = customer.salary ? Number(customer.salary) : 0;

// tax.service.ts — WHT amounts for Excel export
wht: Number(it.whtAmount)
total.getCell('wht').value = Number(data.whtTotal)
```

Salary and WHT are Decimal fields. For Excel export these are display-boundary uses (acceptable). For debt-to-income ratio calculation in `credit-check.service.ts`, use `Prisma.Decimal` arithmetic.

**W3 — `any` type used 117+ times in new production code**  
`documents.service.ts` (`replacePlaceholders(html: string, contract: any)`), several service files. High risk for silent type errors, particularly in contract document generation feeding legal paperwork.

---

### 🔵 INFO

**I1 — `POST /auth/login/2fa` correctly has no JwtAuthGuard**  
This endpoint accepts a `tempToken` (pre-auth state, before full JWT is issued) and intentionally does not use `JwtAuthGuard`. It is validated by `LoginTempTokenDto` (body size-capped). This is correct design — not a missing guard.

**I2 — Frontend 2FA components use `api.post()` correctly**  
`SetupTwoFactorPage.tsx` calls `api.post('/2fa/enroll')` and `api.post('/2fa/confirm')` — follows project convention. No raw `fetch()` usage in new React components.

**I3 — `$queryRaw` calls are all parameterized**  
All new `$queryRaw` usages use `Prisma.sql` tagged template literals. No SQL injection risk.

**I4 — New 2FA DTOs are well-formed**  
`two-factor.dto.ts`, `confirm-2fa.dto.ts`, `disable-2fa.dto.ts` have proper class-validator decorators and Thai error messages. No issues.

**I5 — `EmployeeCombobox` follows project patterns**  
New `EmployeeCombobox.tsx` uses `useQuery` + `api.get()` correctly. No `fetch()` violations.

---

## Recommendation: 🔴 BLOCK

Two blockers must be resolved before merge:

1. **C1** — Add `RolesGuard` + `@Roles(...)` to `TwoFactorController`. The class-level guard is incomplete without both guards.
2. **C2** — Convert the 46+ arithmetic `Number()` calls on Decimal financial fields in `accounting.service.ts`, `data-audit.service.ts`, `scheduler.service.ts`, and `notifications.service.ts` to `Prisma.Decimal` operations. This directly repeats the regression that v4 hardening fixed.
