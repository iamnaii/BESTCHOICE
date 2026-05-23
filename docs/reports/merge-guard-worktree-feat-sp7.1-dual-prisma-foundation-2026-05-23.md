# Merge Guard Report — worktree-feat+sp7.1-dual-prisma-foundation

**Date**: 2026-05-23  
**Branch**: `origin/worktree-feat+sp7.1-dual-prisma-foundation`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

- **78 files changed** — 6,579 insertions, 49 deletions
- New infrastructure: `PrismaFinanceService` (dual-DB), `EntityScopeGuard`, `EntityScopeMiddleware`, `@Entity()` decorator
- New modules: `external-finance` (ExternalFinanceCompany CRUD + commission flow), `consolidated` accounting (cross-entity trial balance / P&L / dashboard)
- New auth fields: `User.accessibleCompanies`, `User.primaryCompany` on JWT payload + `CompanyPillSwitcher` UI
- SP7 migration CLIs: backfill, clone, extract, cutover orchestrator
- Docs: runbooks (`sp7-migration.md`, `sp7-year-end-closing-pre-cutover.md`), design spec (`2026-05-19-shop-finance-legal-split.md`)
- Infra: dual-Postgres CI setup, `MAINTENANCE_MODE` middleware, Sentry entity tagging, dual-DB health probe
- SP7.5: per-entity tax filing scope (SHOP no ภ.พ.30)

---

## Issues

### 🔴 Critical

No Critical issues found. All new controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles()`. Soft-delete patterns are consistent throughout. No `Number()` on financial fields — commission service correctly uses `new Prisma.Decimal(dto.financedAmount)` and `new Prisma.Decimal(dto.commissionRate)`.

---

### 🟡 Warning (should fix)

#### W1 — `FINANCE_MANAGER` missing from `consolidated.controller.ts`

**File**: `apps/api/src/modules/accounting/consolidated.controller.ts`

```ts
@Roles('OWNER', 'ACCOUNTANT')  // class-level
```

All three endpoints (`trial-balance`, `profit-loss`, `dashboard`) inherit this role restriction. However, the existing parallel endpoints on `accounting.controller.ts` (trial balance, P&L, balance sheet) use:

```ts
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
```

The consolidated report is explicitly designed for cross-entity visibility — exactly what `FINANCE_MANAGER` needs. Omitting FM is likely an oversight and will cause unexpected 403s for that role.

**Fix**: Add `'FINANCE_MANAGER'` to the class-level `@Roles` on `ConsolidatedController`.

---

#### W2 — `CreateCommissionDto.commissionRate` missing `@Min(0)` message

**File**: `apps/api/src/modules/external-finance/dto/commission.dto.ts`

```ts
@IsNumber()
@Min(0)
financedAmount!: number;

@IsNumber()
@Min(0)
@Max(1)
commissionRate!: number;
```

Both fields lack `{ message: 'กรุณา...' }` Thai error messages (project convention from backend rules). Also, `financedAmount` should have an `@Min(0)` message and would benefit from `@IsPositive()` to clarify intent. Minor, but keeps conventions consistent.

---

### 🔵 Info

#### I1 — Very large branch scope (78 files)

SP7.1 covers foundation work plus 9 sub-features (sp7.1–sp7.10). Consider whether this can be reviewed and merged in smaller slices (e.g., foundation only: `PrismaFinanceService` + `EntityScope` middleware + auth JWT changes) before landing the full feature set. Large merges increase risk of conflict and are harder to rollback.

#### I2 — Migration CLIs blocked on CPA approval

`extract-shop-from-finance.cli.ts` and the cutover orchestrator include comments like "execution blocked on CPA" — confirm these are guarded at runtime (not just docs) before merge. Currently they appear to be write-only scripts requiring manual invocation, which is fine.

#### I3 — `consolidated.controller.ts` query params parsed directly as `new Date(string)` without validation

```ts
trialBalance(@Query('asOf') asOf?: string) {
  return this.svc.getConsolidatedTrialBalance(asOf ? new Date(asOf) : undefined);
}
```

`new Date('invalid')` returns `Invalid Date` which would propagate to Prisma. Consider adding a `@IsDateString()` query param DTO or a null-check in the service.

---

## Recommendation

> **👁 REVIEW**

No security blockers. The Critical category is clear. The main actionable item is **W1** — add `FINANCE_MANAGER` to `ConsolidatedController` roles to match the existing trial-balance endpoint precedent. W2 (Thai messages) and I3 (date validation) should be fixed before merge. I1 is a process suggestion, not a blocker.
