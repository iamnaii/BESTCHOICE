# Merge Guard Report — feat/collections-workflow-hub

**Date**: 2026-04-24  
**Branch**: `feat/collections-workflow-hub`  
**Author**: Akenarin Kongdach  
**Unique commits over `feat/collections-backlog`**: 2  
**Recommendation**: ✅ APPROVE (unique delta is safe; inherits W1 from collections-ui-p0 if merged separately)

---

## Context

This branch contains the base `collections-foundation` + `collections-backlog` work **plus 2 fix commits** that address review findings from PR #685. The collections-ui-p0 branch is a superset that adds the full UI on top — these two branches diverged from `feat/collections-backlog`.

The 2 unique commits on this branch relative to `feat/collections-ui-p0`:

1. `fix(collections): review findings from PR #685 (C1 search + C3 batch + H1 a11y + H2 cache + H4 promise)` — adds server-side search (`MaxLength(100)`), fixes N+1 promise-kept query, bounded cache, promise-kept rate calculation
2. `fix(collections): Wave 1+2 for #685 (role guard + DTO + TZ + emoji + toLocale + invalidation + unlockMdm hook)` — role guard fixes, DTO corrections, timezone handling, cache invalidation, MDM unlock hook

---

## Changes Reviewed (unique delta vs collections-ui-p0)

### API Changes
- `dto/queue-query.dto.ts`: Added `@IsOptional() @IsString() @MaxLength(100) search?: string` — correct server-side search field with proper validation ✅
- `dto/reject-mdm.dto.ts` (new): Well-formed with Thai validation messages (`กรุณาระบุเหตุผล`, `เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร`) ✅
- `kpi.service.ts` + spec: N+1 fix — replaced `N × findFirst` with single `findMany` for promise-kept rate calculation ✅. Test updated to match (`findMany` mock replaces `findFirst` sequence)
- Cache: Bounded `Map` with capacity cap and explicit `invalidate()` method ✅

### Frontend Changes
- `invalidateQueries` added for `['collections-queue']` and `['pending-mdm']` on MDM approve/reject mutations — previously missing ✅
- `formatNumber()` used for financial display values instead of raw `.toLocaleString()` — consistent formatting ✅

---

## Critical Issues — NONE ✅

## Warning Issues — NONE (in unique delta) ✅

The W1 issue (missing `RolesGuard` on `shop-upload.controller.ts`) exists in the shared base with `collections-ui-p0` — whichever branch is merged first should carry the fix.

## Info Items ℹ️

- The N+1 fix in `kpi.service.ts` (C3) is a meaningful improvement: reduces DB round-trips from O(n) to O(1) for promise-kept rate when there are many candidates.
- The `KpiResult` interface is now exported with proper types (replaces `any` cache value type).

---

## Recommendation

**✅ APPROVE** — the unique delta on this branch is clean, improves correctness, and resolves review findings. Coordinate with `feat/collections-ui-p0` to avoid merge conflicts (they share a large common base).
