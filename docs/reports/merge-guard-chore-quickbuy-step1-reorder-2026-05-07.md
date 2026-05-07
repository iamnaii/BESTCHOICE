# Merge Guard Report — chore/quickbuy-step1-reorder

**Date**: 2026-05-07  
**Branch**: `chore/quickbuy-step1-reorder`  
**Base**: `origin/main` (latest: PR #779)  
**Branch head**: `58871078` — 2026-04-08 15:26  
**Authors**: iamnaii, BESTCHOICE Developer, Claude  
**Commits ahead of main**: 10  
**Diff size**: 2375 files changed, +44,613 / -483,942 lines  

## Context

This branch diverged from an early version of the repository (~PR #413–418 era, before major hardening sprints v2–v4). The diff against current `main` is enormous because `main` has advanced significantly. Merging as-is would require resolving hundreds of conflicts and would **revert** three hardening sprints.

---

## File Changes Summary

| Area | Files Changed |
|------|--------------|
| API Controllers | 20+ (existing, modified) |
| API Services | 30+ |
| Frontend pages | 15+ |
| Prisma migrations | Many added/removed |
| New modules added | `exchange/` (replaces `defect-exchange/`) |

---

## Issues

### Critical (must fix before merge)

#### C1 — BranchGuard removed from 16+ controllers

**Severity**: CRITICAL — silent cross-branch data leakage  
**File(s)**:
- `apps/api/src/modules/contracts/contracts.controller.ts`
- `apps/api/src/modules/customers/customers.controller.ts`
- `apps/api/src/modules/payments/payments.controller.ts`
- `apps/api/src/modules/credit-check/credit-check.controller.ts`
- `apps/api/src/modules/overdue/overdue.controller.ts`
- `apps/api/src/modules/finance-receivable/finance-receivable.controller.ts`
- `apps/api/src/modules/dashboard/dashboard.controller.ts`
- `apps/api/src/modules/asset/asset.controller.ts`
- `apps/api/src/modules/inventory/branch-receiving.controller.ts`
- `apps/api/src/modules/inventory/inventory-forecast.controller.ts`
- `apps/api/src/modules/inventory/reorder-points.controller.ts`
- `apps/api/src/modules/inventory/stock-adjustments.controller.ts`
- `apps/api/src/modules/inventory/stock-count.controller.ts`
- `apps/api/src/modules/inter-company/inter-company.controller.ts`
- `apps/api/src/modules/expenses/*.controller.ts`
- + more

**Description**: The branch predates the `BranchGuard` additions from hardening sprint v1 (PR #430). Every controller listed above has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on `main` but the branch has only `@UseGuards(JwtAuthGuard, RolesGuard)`. A SALES/BRANCH_MANAGER user at branch A would be able to read contracts, customers, and payments from branch B.

**Also**: `apps/api/src/modules/auth/branch-access.util.ts` and its test file `branch-access.util.spec.ts` are entirely deleted by this branch.

#### C2 — Decimal arithmetic reverted to `Number()` in accounting service

**Severity**: CRITICAL — financial precision loss  
**File**: `apps/api/src/modules/accounting/accounting.service.ts`

**Lines removed (Decimal-safe)**:
```typescript
// REMOVED — v4 hardening
const amt = new Prisma.Decimal(e.totalAmount);
totalAmount = new Prisma.Decimal(totalAmount).add(amt).toNumber();
const vatRate = vatConfig ? d(vatConfig.value) : d(0.07);
vatAmount = dRound(dMul(dto.amount, vatRate)).toNumber();
const totalAmount = dRound(dAdd(dto.amount, vatAmount)).toNumber();
```

**Lines added (precision loss)**:
```typescript
// ADDED — regresses to floating point
const amt = Number(e.totalAmount);
totalAmount += amt;
const vatRate = vatConfig ? Number(vatConfig.value) : 0.07;
vatAmount = Math.round(dto.amount * vatRate * 100) / 100;
const totalAmount = dto.amount + vatAmount;
```

The branch reverts hardening from v4 (PR #444-448) which fixed 53 `Number()` → `Prisma.Decimal` in 12 services. Financial aggregations with JS floating point accumulate rounding errors (e.g. 0.1 + 0.2 ≠ 0.3).

---

### Warning (should fix before merge)

#### W1 — Several queries missing `deletedAt: null`

**Severity**: WARNING  
**File**: `apps/api/src/modules/contracts/contracts.service.ts`, others  
New `contract.findFirst`, `customer.findMany`, `payment.findMany` queries added without `where: { deletedAt: null }`. Soft-deleted records would appear in results.

#### W2 — Exchange module replaces defect-exchange without migration guard

**Severity**: WARNING  
**File**: `apps/api/src/modules/exchange/exchange.controller.ts` (new), `apps/api/src/modules/defect-exchange/` (deleted)  
The new `ExchangeController` is correctly guarded (`JwtAuthGuard, RolesGuard + @Roles`). However, deleting `defect-exchange` module while `main` has evolved may cause migration conflicts.

---

### Info

#### I1 — Large overall diff (2375 files)

The branch has a 2375-file diff against `main`. Most deletions (-483K lines) are from features on `main` that don't exist in this branch. A direct merge would cause mass merge conflicts. **Rebase onto main** is the correct path.

#### I2 — Commit history includes PR #413-#418 features

Features like `feat(chatbot-finance)` (PR #413) and `feat(trade-in): Quick Buy wizard` (PR #418) are included. These may already be on `main` via their own merged PRs — need to verify.

---

## Recommendation: 🚫 BLOCK

**Do NOT merge this branch.** The branch diverged from an early pre-hardening version of the codebase. Merging would:

1. Remove `BranchGuard` from 16+ controllers — **immediate security regression**
2. Revert Decimal precision fixes from v2/v4 hardening — **financial accuracy regression**
3. Delete `branch-access.util.ts` — removes the branch-access source of truth

**Required action before merge**:
1. Identify which commits on this branch are NOT already merged to `main` (use `git log --cherry-pick`)
2. Cherry-pick only the unreleased commits onto a fresh branch from `main`
3. Re-apply `BranchGuard` and Decimal precision to any modified services
4. Re-run `./tools/check-types.sh all` and full test suite
