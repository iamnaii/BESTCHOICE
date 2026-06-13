# Pre-Merge Guard Report: feat/payroll-backfill

**Date**: 2026-06-13  
**Branch**: `origin/feat/payroll-backfill`  
**Authors**: Akenarin Kongdach, iamnaii  
**Commits ahead of main**: 158  
**Last commit**: 2026-06-05  

---

## File Changes Summary

- **491 TypeScript/TSX files changed** vs `main`
- New modules: `two-factor`, `employees`, `backfill-employee-profiles` CLI, `backfill-payroll-user-fk` CLI
- Key areas: payroll service, employee module, accounting.service.ts, data-audit.service.ts, contracts.service.ts

---

## Issues by Severity

### 🔴 CRITICAL

**C1 — `TwoFactorController` missing `RolesGuard` + `@Roles()`**  
File: `apps/api/src/modules/two-factor/two-factor.controller.ts`

New controller uses `@UseGuards(JwtAuthGuard)` only — `RolesGuard` is absent. None of the 4 endpoints (`/2fa/enroll`, `/2fa/confirm`, `/2fa/disable`, `/2fa/backup-codes`) have `@Roles(...)`. Per project security rules, every controller must have both guards at class level and `@Roles()` on every method.

**Fix**: Add `RolesGuard` to the class guard and add `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` to each method (all authenticated roles may manage their own 2FA).

---

**C2 — `Number()` wrapping Decimal money fields in arithmetic contexts**  
Files: `apps/api/src/modules/contracts/contracts.service.ts`, `accounting.service.ts`, `bank-reconciliation.service.ts`

Multiple new arithmetic operations convert `Prisma.Decimal` to JavaScript `number` before calculations — repeating the pattern that v4 hardening eliminated from 53 sites. Critical examples:

```ts
// contracts.service.ts — arithmetic comparisons with Decimal
Number(dto.interestRate) !== Number(contract.interestRate)  // .equals() should be used
Number(contract.sellingPrice)  // used in reduce accumulator

// accounting.service.ts — financial bucket calculation
const remaining = Number(p.amountDue) - Number(p.amountPaid ?? 0);

// bank-reconciliation.service.ts — reconciliation comparison
this.amountMatches(Number(p.amountPaid), line.amount)
```

**Fix**: Use `new Prisma.Decimal(x).sub(y)` for arithmetic, `decimal.equals(other)` for comparisons, reserve `.toNumber()` only for final serialization to client.

---

**C3 — Missing `deletedAt: null` on two `sale.findMany` queries**  
File: `apps/api/src/modules/accounting/accounting.service.ts`

Two new `this.prisma.sale.findMany` calls filter by `{ createdAt: dateRange, ...branchFilter }` but omit `deletedAt: null`. Soft-deleted sales will appear in revenue reports and P&L calculations.

---

### 🟡 WARNING

**W1 — Duplicate 2FA endpoints between `auth.controller.ts` and `two-factor.controller.ts`**  
`auth.controller.ts` adds `POST /auth/2fa/generate`, `/2fa/enable`, `/2fa/disable` (with per-method `@UseGuards(JwtAuthGuard)` but no `@Roles`). New `TwoFactorController` adds overlapping endpoints. Both sets lack `@Roles` constraints and the intended routing is ambiguous.

**W2 — `$queryRaw` bare template interpolation in `data-audit.service.ts`**  
~15 new `$queryRaw` calls use raw backtick templates. `LIMIT ${options.limit || 100}` interpolates directly. Prisma's tagged templates do escape values, but this pattern should be verified: ensure `options.limit` is never user-controlled (confirm validated as integer before use).

**W3 — `any` type used in 116+ new production lines**  
`data-audit.service.ts`, `notification.worker.ts`, and others use `any` in new production code. High risk for silent type errors at runtime.

---

### 🔵 INFO

**I1 — Backfill CLI writes CSV to CWD**  
`apps/api/src/cli/backfill-payroll-user-fk.cli.ts` calls `writeFileSync('matched-by-name.csv', ...)` relative to CWD. On Cloud Run this writes to a non-persistent ephemeral path. Acceptable for a one-time CLI, but the path should be documented in the runbook.

**I2 — `$queryRaw` in accounting.service.ts uses `Prisma.sql` safely**  
10 new `$queryRaw` calls in `accounting.service.ts` use `Prisma.sql` tagged template literals — parameterized and safe.

---

## Recommendation: 🔴 BLOCK

Three blockers must be resolved before merge:

1. **C1** — Add `RolesGuard` + `@Roles(...)` to `TwoFactorController`.
2. **C2** — Replace `Number()` arithmetic on Decimal fields with `Prisma.Decimal` operations in `contracts.service.ts`, `accounting.service.ts`, and `bank-reconciliation.service.ts`.
3. **C3** — Add `deletedAt: null` to the two bare `sale.findMany` queries in `accounting.service.ts`.
