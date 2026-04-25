# Merge Guard Report — fix/dashboard-cache-graceful-degrade

**Date**: 2026-04-25  
**Branch**: `fix/dashboard-cache-graceful-degrade`  
**Author**: Akenarin Kongdach  
**Latest commit**: `ab0e509e` — fix(dashboard): cache wrap ป้องกันล่มถ้า Redis ดาวน์ (Sprint 2b)  
**Recommendation**: ✅ APPROVE

---

## Summary of Changes

The branch is behind `origin/main` by PRs #532–#701. The **only new code** not in main is one commit changing two files:

| File | Lines | Change |
|------|-------|--------|
| `apps/api/src/modules/dashboard/dashboard.service.ts` | +24 | Wrap `cache.get` and `cache.set` in try/catch with structured-log warn on failure |
| `apps/api/src/modules/dashboard/dashboard.service.spec.ts` | +74 | New spec file: 4 test cases for cache hit, miss, get-throws, set-throws |

**Root cause fixed**: `DashboardService.cached<T>()` had no error handling around Redis calls. A Redis connection drop caused every dashboard query to throw → HTTP 500 on the dashboard page.

**Fix**: both `cache.get` and `cache.set` now degrade gracefully — log a `warn` and fall through to the DB computation so the dashboard always renders.

---

## Issues by Severity

### Critical — 0 issues

### Warning — 0 issues

### Info — 2 issues

**I1 — Test mock uses raw numbers for Decimal aggregates**  
`dashboard.service.spec.ts:30`:
```ts
_sum: { amountDue: 0, amountPaid: 0, lateFee: 0 }
```
Production Prisma returns `Decimal` objects here, not raw numbers. The mock returns `0` (number). The tests only verify cache-hit/miss/throw behavior (not financial computation), so this doesn't affect correctness — but a stricter mock would use `new Prisma.Decimal(0)`. Low risk, no production impact.

**I2 — Branch not rebased on main**  
The branch diverged from main around PR #531 (Apr 19). It is missing PRs #532–#701 including the Portal fix (#700) and taxId optional fix (#698). These would need to be merged in before or after this branch is merged into main via a standard merge strategy. The fix itself is isolated to `dashboard.service.ts` so merge conflicts are unlikely.

---

## Notes

- `@UseGuards(JwtAuthGuard, RolesGuard)` is intact on `DashboardController` (not changed by this branch).
- No money fields are modified; the `cached<T>` helper wraps generic KPI objects.
- Tests cover all four cache degradation paths: hit, miss, `get` throws, `set` throws.
- `structuredLogger.warn(...)` on degraded cache is the correct observability pattern.
