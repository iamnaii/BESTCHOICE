# Merge Guard Report — chore/audit-quick-wins

**Date**: 2026-05-07  
**Branch**: `chore/audit-quick-wins`  
**Base**: `origin/main` (latest: PR #779)  
**Branch head**: `b00d5ac5` — 2026-04-26 20:17  
**Authors**: iamnaii (Akenarin Kongdach)  
**Commits ahead of main**: 4  
**Diff size**: 540 files changed, +11,200 / -85,354 lines  

## Context

This branch contains 4 commits on top of a diverged base. Like the other candidate branches, it originated before the v4 hardening sprint. The diff against `main` is large because `main` has moved forward significantly.

Commits on this branch:
1. `fix(security): throttle public endpoints + file upload validators`
2. `perf(audit): dashboard staff metrics groupBy + 3 compound indexes`
3. `feat(collections): guided session workflow + simplifications`
4. `feat(collections): remove Customer 360 hover-snapshot popup`

---

## File Changes Summary

| Area | Files Changed |
|------|--------------|
| API Services | 60+ (including many shared with other branches) |
| Frontend pages | 20+ |
| Tests | 15+ spec files |
| New features | Collections guided session, throttle config, audit perf |

---

## Issues

### Critical (must fix before merge)

#### C1 — `Number()` used in financial aggregation (accounting service)

**Severity**: CRITICAL — financial precision loss  
**File**: `apps/api/src/modules/accounting/accounting.service.ts`

Added lines using `Number()` on Decimal financial fields:
```typescript
// Aggregation uses plain JS numbers — floating point precision loss
const amt = Number(e.totalAmount);
totalAmount += amt;
byAccountType[e.accountType] = (byAccountType[e.accountType] || 0) + amt;
byCategory[e.category] = (byCategory[e.category] || 0) + amt;

// VAT calculation
const vatRate = vatConfig ? Number(vatConfig.value) : 0.07;
vatAmount = Math.round(dto.amount * vatRate * 100) / 100;
const totalAmount = dto.amount + vatAmount;

// Update
const amount = dto.amount ?? Number(expense.amount);
const vatAmount = dto.vatAmount ?? Number(expense.vatAmount);
const withholdingTax = dto.withholdingTax ?? Number(expense.withholdingTax);
```

The `main` branch replaced these with `Prisma.Decimal` arithmetic in v4 (PR #444-448). This branch predates that hardening and reintroduces floating-point precision errors in expense and VAT calculations.

---

### Warning (should fix)

#### W1 — Several service queries missing `deletedAt: null`

**Severity**: WARNING  
**File(s)**: Multiple service files  

New queries on models with soft-delete (`Payment`, `Product`, `JournalEntry`) were added without `where: { deletedAt: null }`:
- `payment.findMany` — could return soft-deleted payment records
- `product.findUnique` — soft-deleted products visible in results
- `journalEntry.findFirst` (inside transaction) — verify these include `deletedAt: null`

Models like `ChartOfAccount`, `SystemConfig`, `CompanyInfo` likely don't have `deletedAt` — those query patterns are acceptable.

#### W2 — `$queryRaw` verified safe (parameterized)

**Severity**: INFO  
**File**: `apps/api/src/modules/accounting/accounting.service.ts`

Multiple `$queryRaw` calls exist but all use `Prisma.sql` template literals (parameterized). No SQL injection risk. Confirmed:
```typescript
prisma.$queryRaw<...>(Prisma.sql`SELECT ... WHERE deleted_at IS NULL ...`)
```

#### W3 — Thai validation messages audit needed on new DTOs

**Severity**: WARNING  
Several new DTO files were added. Quick scan shows English-language error messages in some. Per project conventions, all validation errors should be in Thai.

---

### Info

#### I1 — `fix(security): throttle public endpoints + file upload validators`

This commit adds rate limiting to public endpoints (sms-webhook, paysolutions) and file upload validators. These are **positive security improvements**. The implementation should be cherry-picked to main via a clean branch.

#### I2 — `perf(audit): dashboard staff metrics groupBy + 3 compound indexes`

Adds `groupBy` optimization for dashboard queries and 3 new compound indexes. Positive performance improvement — verify the index migration doesn't conflict with main's schema.

#### I3 — Large diff makes conflict resolution complex

540 files changed means significant rebase work needed. Most deletions are features on `main` that don't exist on this branch.

---

## Recommendation: 🔶 REVIEW (rebase required)

The 4 new commits contain genuinely useful work (throttle fix, perf indexes, collections session). However:

1. **C1 must be fixed**: The `Number()` regression in `accounting.service.ts` must be reverted to `Prisma.Decimal`
2. **Rebase required**: Branch needs to be rebased onto `main` to pick up all hardening changes (BranchGuard, Decimal precision, etc.)

**Suggested path**:
1. `git rebase origin/main` on this branch (resolve conflicts preserving `main`'s security guards)
2. Fix C1 — rewrite accounting service aggregations using `Prisma.Decimal`
3. Fix W1 — add `deletedAt: null` to affected queries
4. Run `./tools/check-types.sh all` + full test suite
5. Re-submit for review
