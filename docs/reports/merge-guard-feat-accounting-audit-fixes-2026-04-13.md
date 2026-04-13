# Merge Guard Report — `feat/accounting-audit-fixes`

**Date**: 2026-04-13  
**Branch**: `feat/accounting-audit-fixes`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main**: 5 commits (latest: 2026-04-06)  
**Recommendation**: 🔴 **BLOCK — Do not merge**

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| TypeScript files changed | 631 |
| Spec files deleted | **55** |
| Net lines (approx) | -5,000+ (massive rollback) |

Key changed files:
- `apps/api/src/modules/accounting/accounting.controller.ts` — guard + role changes
- `apps/api/src/modules/accounting/accounting.service.ts` — 46 `Number()` on Decimal fields
- `apps/api/src/modules/accounting/bad-debt.service.ts` — role/logic changes
- 55 `.spec.ts` files **deleted** across the entire codebase

---

## Issues by Severity

### 🔴 Critical (must fix before merge)

#### C-001: 46 `Number()` calls on Decimal money fields — `accounting.service.ts`
**Rule violated**: `database.md` — "ใช้ Decimal เท่านั้น: @db.Decimal(12, 2) — ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน"

The new accounting service replaces `Prisma.Decimal` arithmetic with raw `Number()` casts on financial fields. This causes **floating-point precision loss** on financial calculations.

Examples of new regressions (all newly introduced):
```typescript
const amt = Number(e.totalAmount);                          // expense total
breakdown[e.category].total += Number(e.totalAmount);      // category sum
const cashSales = Number(cashSalesAgg._sum.netAmount || 0);
const grossReceivables = Number(hpReceivables._sum.amountDue || 0);
const allowanceForDoubtful = Number(provisions._sum.provisionAmount || 0);
// ... 40+ more
```
This directly reverts precision fixes from hardening v4 (PR #444–#448) where 53 `Number()` were converted to `Prisma.Decimal`.

**Fix**: Replace all `Number(decimal_field)` with `new Prisma.Decimal(field || 0)` and use `.add()`, `.toNumber()` only at the final serialization step for JSON responses.

---

#### C-002: `FINANCE_MANAGER` role removed from 15+ endpoints — `accounting.controller.ts` and others
**Rule violated**: Business requirement — FINANCE_MANAGER has cross-branch financial oversight access.

The branch removes `FINANCE_MANAGER` from all expense/accounting endpoints:
```typescript
// Before (main):
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')

// After (this branch):
@Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
```

This affects: `POST /expenses`, `GET /expenses`, `GET /expenses/summary`, `GET /expenses/:id`, `PATCH /expenses/:id`, `POST /expenses/:id/void`, `POST /expenses/:id/approve`, and 8+ more endpoints. The `finance@bestchoice.com` test account (FINANCE_MANAGER role) would be locked out of all expense/accounting operations.

The branch also replaces `hasCrossBranchAccess()` with a hardcoded `role === 'OWNER' || role === 'ACCOUNTANT'` check — duplicating the cross-branch logic and bypassing the single source of truth established in `branch-access.util.ts` (hardening v1).

**Fix**: Restore `FINANCE_MANAGER` to all affected endpoints. Use `hasCrossBranchAccess()` from `branch-access.util.ts` instead of inline role checks.

---

#### C-003: `BranchGuard` removed from `accounting.controller.ts`
**Rule violated**: `security.md` + hardening v1 (BranchGuard on 22 controllers).

```typescript
// Before (main):
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)

// After (this branch):
@UseGuards(JwtAuthGuard, RolesGuard)
```

BranchGuard enforces that branch-scoped users (BRANCH_MANAGER, SALES) can only access their own branch's data. Removing it means a `BRANCH_MANAGER` at branch A could query expenses for branch B by passing `?branchId=<branch-b-id>`.

**Fix**: Restore `BranchGuard` to the controller class decorator.

---

#### C-004: 55 spec files deleted — test coverage regression
The branch deletes 55 `.spec.ts` files including:
- `accounting.service.spec.ts` (~829 lines, 47 tests from v4)
- `bad-debt.service.spec.ts` (~419 lines, 22 tests from v4)
- `auth.service.spec.ts`
- `branch-access.util.spec.ts`
- `branch.guard.spec.ts`
- `commission.service.spec.ts`
- `contracts.service.spec.ts`
- `finance-receivable.service.spec.ts`
- And 47 more...

Post-v4 API test count was **577 tests (26 suites)**. This branch eliminates the majority of that coverage. The test suite passing after this merge would be a false green.

**Fix**: Do not delete spec files. If the underlying code changed, update the specs to match the new behaviour.

---

### ⚠️ Warning (should fix)

#### W-001: Inline cross-branch logic breaks `branch-access.util.ts` contract
```typescript
// New inline check — bypasses the centralized utility:
const effectiveBranchId =
  req?.user?.role === 'OWNER' || req?.user?.role === 'ACCOUNTANT'
    ? branchId
    : req?.user?.branchId || branchId;
```
`branch-access.util.ts` is the single source of truth for `CROSS_BRANCH_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']`. Inline duplication will diverge over time and has already excluded `FINANCE_MANAGER` from cross-branch access (see C-002).

#### W-002: Large diff makes review impractical
631 TypeScript files changed in a branch titled "accounting audit fixes". Many deletions appear unrelated to accounting (chatbot specs, commission specs, import scripts). The scope is unclear and too large for safe review. The accounting changes should be extracted into a focused branch.

---

### ℹ️ Info

#### I-001: Migration file deletions
Several migration SQL files are deleted. If these migrations were already applied to staging/production, deleting them from the repo will cause `prisma migrate status` to show "migration not found" errors on next deploy.

#### I-002: `seed-chart-of-accounts-only.ts` deleted
This standalone production-safe seed script was intentionally created for COA seeding on production. Its removal may complicate future operations.

---

## Recommendation

**🔴 BLOCK** — This branch has 4 Critical issues:

1. **Precision**: 46+ `Number()` regressions on financial Decimal fields — directly violates money handling rules and reverts v4 hardening.
2. **Access control**: FINANCE_MANAGER locked out of all accounting endpoints — breaks business requirement for finance oversight.
3. **Security**: BranchGuard removed — opens cross-branch data leak for BRANCH_MANAGER role.
4. **Test coverage**: 55 spec files deleted — destroys the 577-test suite built across hardening v1–v4.

**Recommended path forward**: Extract the legitimate accounting changes (inter-company transactions, chart-of-accounts improvements) into a clean branch that preserves guards, roles, Decimal precision, and existing tests.
