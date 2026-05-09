# Merge Guard Report — `chore/audit-quick-wins`

**Date**: 2026-05-09  
**Branch**: `origin/chore/audit-quick-wins`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Merge base**: **NONE — orphan branch**  
**Commits**: 4 (entire branch history — no shared ancestry with `origin/main`)  

## File Changes Summary

Branch contains 4 commits (newest first):

| SHA | Message |
|-----|---------|
| `b00d5ac5` | fix(security): throttle public endpoints + file upload validators |
| `b42b7bb9` | perf(audit): dashboard staff metrics groupBy + 3 compound indexes |
| `9922aca3` | feat(collections): guided session workflow + simplifications |
| `84f6e7e7` | feat(collections): remove Customer 360 hover-snapshot popup |

Key files touched: `broadcast.controller.ts`, `line-oa.controller.ts`, `shop-auth-social.controller.ts`, `shop-installment-apply.controller.ts`, `shop-reservation.controller.ts`, `shop-tracking.controller.ts`, `web-widget.controller.ts`, `dashboard.service.ts`, collections UI components.

---

## Issues

### Critical (must fix before merge)

#### C1 — Orphan branch: no merge base with `origin/main`
**Impact**: `git merge` will fail with `fatal: refusing to merge unrelated histories`.  

This branch has exactly 4 commits and no shared commit history with `origin/main`. It cannot be merged via normal `git merge` or a pull request merge button.

**Fix required** — choose one:
1. **Rebase** (preferred): `git rebase origin/main` from the branch — replays the 4 commits on top of current `main`. Resolve any conflicts, then force-push.
2. **Cherry-pick**: `git cherry-pick b00d5ac5 b42b7bb9 9922aca3 84f6e7e7` onto `main` directly (or a new branch from `main`).

Until this is resolved, the branch **cannot be merged** regardless of code quality.

---

### Warning (should fix)

#### W1 — `user.findMany` and `branch.findMany` missing `deletedAt: null`
**File**: `apps/api/src/modules/dashboard/dashboard.service.ts` (commit `b42b7bb9`)  
**Code**:
```typescript
this.prisma.user.findMany({
  where: { id: { in: salespersonIds } },   // ← missing deletedAt: null
  select: { id: true, name: true },
})
this.prisma.branch.findMany({
  where: { id: { in: branchIds } },        // ← missing deletedAt: null
  select: { id: true, name: true },
})
```
Soft-deleted users or branches would appear in dashboard staff-metrics if their IDs still exist on active contracts. Low probability but violates the project-wide soft-delete rule.  
**Fix**: Add `deletedAt: null` to both `where` clauses.

---

#### W2 — `totalSales` uses `.toNumber()` on `Prisma.Decimal`
**File**: `apps/api/src/modules/dashboard/dashboard.service.ts` (commit `b42b7bb9`)  
**Code**:
```typescript
const sellingSum = new Prisma.Decimal(a._sum.sellingPrice ?? 0).toNumber();
// and later:
existing.totalSales = new Prisma.Decimal(existing.totalSales)
  .add(new Prisma.Decimal(a._sum.sellingPrice ?? 0))
  .toNumber();
```
`totalSales` is a dashboard display metric (not persisted), so floating-point precision loss is unlikely to cause financial error. However, it violates the project rule against `Number()` on money fields.  
**Fix**: Keep `totalSales` as `Prisma.Decimal` in the accumulator and convert to `number` only at the final response mapping step — or document the exception in code since this is display-only.

---

### Info

#### I1 — `ShopBotDefenseGuard` added to shop controllers without `JwtAuthGuard`
**Files**: `shop-auth-social.controller.ts`, `shop-installment-apply.controller.ts`, `shop-reservation.controller.ts`, `shop-tracking.controller.ts`  
These are intentionally public shop endpoints (not in the admin API). `ShopBotDefenseGuard` serves as the authentication mechanism here. Confirmed consistent with the existing public-endpoint exceptions listed in `.claude/rules/security.md`. No issue.

---

## Recommendation: **BLOCK**

The branch cannot be merged in its current state due to the orphan history (C1). The code changes themselves are valuable (security throttling, perf refactor, collections UI). Once rebased onto `origin/main`, fix W1 (missing `deletedAt: null`) and W2 (`.toNumber()` on money) before merging.

**Suggested unblock steps**:
```bash
git checkout chore/audit-quick-wins
git rebase origin/main    # resolve any conflicts
git push --force-with-lease origin chore/audit-quick-wins
```
Then re-run guard review on the rebased branch.
