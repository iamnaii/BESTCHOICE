# Pre-Merge Guard Report — feat/collections-guided-session

**Date**: 2026-04-26  
**Branch**: `feat/collections-guided-session`  
**Author**: Akenarin Kongdach  
**Commits**: Multiple (large feature branch)  
**Recommendation**: ⚠️ REVIEW — 1 Critical issue must be fixed before merge

---

## File Changes Summary

86 files changed, 10,193 insertions, 3,357 deletions.

**New backend module** — `apps/api/src/modules/collections-session/`:

| File | Lines | Purpose |
|------|-------|---------|
| `collections-session.controller.ts` | 64 | Session REST API (start, action, skip, pool, team-dashboard) |
| `collections-session.service.ts` | 212 | Session business logic |
| `auto-assign.service.ts` | 261 | Daily auto-assignment cron logic |
| `team-dashboard.service.ts` | 212 | Team KPI aggregation |
| `pool.service.ts` | 67 | Pool claim/list |
| `collections-session.cron.ts` | 92 | Daily cron with Sentry capture |
| `collections-summary.service.ts` | 132 | End-of-session LINE message |
| `dto/action.dto.ts` | 20 | Validated DTO |
| `dto/skip.dto.ts` | 12 | Validated DTO |
| `*.spec.ts` (4 files) | ~519 | Unit tests |

**Frontend** — `apps/web/src/pages/CollectionsPage/session/` (new):

| File | Lines |
|------|-------|
| `FocusMode.tsx` | 242 |
| `FocusContractCard.tsx` | 185 |
| `PreStartScreen.tsx` | 155 |
| `SessionSummary.tsx` | 153 |
| `SessionView.tsx` | 143 |
| `SkipReasonDialog.tsx` | 73 |
| `PoolBrowser.tsx` | 91 |
| `SessionTimer.tsx` | 53 |
| `SessionProgress.tsx` | 21 |

**Other significant changes**: MDM lock/unlock endpoints by contractId, Settings collections config endpoints, SettingsPage config card, CollectionsHeader rewrite, E2E spec.

---

## Issues Found

### Critical (must fix before merge)

#### C-001 — `Number()` on Prisma Decimal financial field

**File**: `apps/api/src/modules/collections-session/team-dashboard.service.ts:134`

```typescript
// CURRENT (incorrect)
const collectedByCollector = new Map(
  todayPayments.map((p) => [p.recordedById!, Number(p._sum.amountPaid ?? 0)]),
);

// REQUIRED (correct)
const collectedByCollector = new Map(
  todayPayments.map((p) => [p.recordedById!, new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()]),
);
```

`amountPaid` is a `@db.Decimal(12,2)` field. The v4 hardening sprint explicitly eliminated all `Number(_sum` usages ("0 `Number(_sum` remaining"). This is a direct regression against that policy. Fix: replace `Number(p._sum.amountPaid ?? 0)` with `new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()`.

---

### Warning (should fix)

#### W-001 — Missing `deletedAt: null` on `recentAssignments` query

**File**: `apps/api/src/modules/collections-session/auto-assign.service.ts:108-111`

```typescript
// CURRENT (missing soft-delete filter)
const recentAssignments = await this.prisma.dailyAssignment.findMany({
  where: {
    date: { gte: addDays(dateOnly, -RECENT_RELATIONSHIP_DAYS) },
    collectorId: { not: null },
  },
  // …
});

// REQUIRED
const recentAssignments = await this.prisma.dailyAssignment.findMany({
  where: {
    date: { gte: addDays(dateOnly, -RECENT_RELATIONSHIP_DAYS) },
    collectorId: { not: null },
    deletedAt: null,    // ← add this
  },
  // …
});
```

`DailyAssignment` has `deletedAt DateTime?` (confirmed in schema). Without the filter, soft-deleted assignments can influence the "recent relationship" scoring in auto-assign, routing a contract to a collector who should no longer have it.

---

### Info

#### I-001 — `user: any` in new controller

**File**: `apps/api/src/modules/collections-session/collections-session.controller.ts:22,27,32,37,43,48`

All 6 route handlers type the `@CurrentUser()` parameter as `any`. Other controllers in the codebase (e.g. `customers.controller.ts`) use `{ id: string; branchId?: string }`. The controller accesses `user.id`, `user.branchId`, and `user.role` — all of which should be typed to avoid silent property access errors.

---

## Positive Findings

- **New controller is properly guarded**: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level + `@Roles(...)` on every method. ✅
- **MDM new endpoints** (`/mdm/contracts/:id/lock` and `/mdm/contracts/:id/unlock`) inherit the MDM controller's class-level `@UseGuards(JwtAuthGuard, RolesGuard)` and have `@Roles(...)` on each. ✅
- **Settings new endpoints** (`GET/PUT /settings/collections`) inherit the class-level `@Roles('OWNER')`. ✅
- **All frontend mutations** use `api.get()`/`api.post()` from `@/lib/api` — no raw `fetch()` in React components. ✅
- **All `useMutation` hooks** (except `useViewToggle`, which calls `refresh()` instead) have matching `invalidateQueries` in `onSuccess`. ✅
- **No hardcoded secrets or API keys** detected. ✅
- **All new DTOs** (`ActionDto`, `SkipDto`, `CollectionsConfigDto`) use class-validator decorators. ✅
- **Cron has Sentry capture** on failure. ✅
- **No files exceed 500 lines** (largest new source file is `team-dashboard.service.ts` at 212 lines). ✅
- **`useViewToggle`** uses `useMutation` without `invalidateQueries` — intentional, calls `AuthContext.refresh()` to update user preferences from the server. Not a bug. ✅

---

## Required Actions Before Merge

1. **[Critical]** Fix `team-dashboard.service.ts:134` — replace `Number(p._sum.amountPaid ?? 0)` with `new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()`.  
   Also verify there are no other `Number(_sum` patterns in any new files: `grep -rn "Number(.*\._sum\." apps/api/src/modules/collections-session/`

2. **[Warning]** Add `deletedAt: null` to `auto-assign.service.ts:110` in the `recentAssignments` query.

3. **[Info / Optional]** Type the `@CurrentUser()` parameter in `collections-session.controller.ts` as `{ id: string; branchId?: string; role: string }` instead of `any`.
