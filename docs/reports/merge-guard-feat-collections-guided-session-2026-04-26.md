# Merge Guard Report — feat/collections-guided-session

**Date**: 2026-04-26  
**Branch**: `feat/collections-guided-session`  
**Author**: Akenarin Kongdach  
**Against**: `origin/main`  
**Recommendation**: 🔴 **BLOCK** — 2 Critical issues must be fixed before merge

---

## File Changes Summary

| Area | Files Changed | Lines |
|------|--------------|-------|
| Prisma schema + migrations | 3 | +154 |
| API: new module (collections-session) | 9 | +875 |
| API: auth controller/service | 3 | +35 |
| API: settings controller/service/dto | 3 | +75 |
| Frontend: CollectionsPage components | 19 | ~+2,100 |
| E2E test | 1 | +57 |

Total: **38 files changed**, large feature addition.

---

## Issues by Severity

### 🔴 Critical (must fix before merge)

#### C-1 — `PUT /settings/collections` accessible by any authenticated user

**File**: `apps/api/src/modules/settings/settings.controller.ts`  
**Lines**: The two new methods `getCollectionsConfig()` and `updateCollectionsConfig()` are missing `@Roles()` decorators.

```typescript
// ❌ Missing @Roles() — RolesGuard silently passes when no decorator is present
@Get('collections')
getCollectionsConfig() { ... }

@Put('collections')
async updateCollectionsConfig(@Body() dto: CollectionsConfigDto, ...) { ... }
```

The class has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level, but `RolesGuard.canActivate()` returns `true` when `requiredRoles` is `undefined`. This means any authenticated user — including **SALES** — can call `PUT /settings/collections` and modify the `dailyCap`, `workloadFloor`, `sessionTargetMin`, etc. for all collectors.

**Fix**: Add `@Roles()` to both methods:
```typescript
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
@Get('collections')
getCollectionsConfig() { ... }

@Roles('OWNER')            // Config changes = owner-only
@Put('collections')
async updateCollectionsConfig(...) { ... }
```

---

#### C-2 — Hard delete on `DailyAssignment` violates soft-delete rule

**File**: `apps/api/src/modules/collections-session/auto-assign.service.ts`  
**Line**: `await tx.dailyAssignment.deleteMany({ where: { date: dateOnly, status: 'PENDING' } });`

`DailyAssignment` has `deletedAt DateTime?` (soft-delete enabled). The rule is "ห้าม hard delete เด็ดขาด" for all models with `deletedAt`. Using `deleteMany` permanently erases audit trail of which contracts were in yesterday's PENDING queue — this is relevant if a reassignment dispute arises.

**Fix**: Replace with soft-delete:
```typescript
await tx.dailyAssignment.updateMany({
  where: { date: dateOnly, status: 'PENDING', deletedAt: null },
  data: { deletedAt: new Date() },
});
```
Then update all downstream queries that don't already filter `deletedAt: null` (see W-1 below).

---

### 🟡 Warning (should fix)

#### W-1 — `recentAssignments` query missing `deletedAt: null` filter

**File**: `apps/api/src/modules/collections-session/auto-assign.service.ts`  
**Query**: `recentAssignments` used to build `recentByContract` relationship map.

```typescript
// ❌ No deletedAt: null — includes soft-deleted assignments in "recent relationship"
const recentAssignments = await this.prisma.dailyAssignment.findMany({
  where: {
    date: { gte: addDays(dateOnly, -RECENT_RELATIONSHIP_DAYS) },
    collectorId: { not: null },
  },
  ...
});
```

After fixing C-2, soft-deleted records from re-runs would be included and could incorrectly influence the `AUTO_RECENT` assignment source. Add `deletedAt: null`.

---

#### W-2 — `any` type casts in `collections-session.service.ts`

**File**: `apps/api/src/modules/collections-session/collections-session.service.ts`

Multiple uses of `(a.contract as any).customer?.phone` and `(a.contract as any).customer?.lineId` inside `getMySession()`. The `include` query already returns typed data — define a local interface or use Prisma's `GetPayload` utility to avoid silently hiding type errors.

---

#### W-3 — `PATCH /auth/me/preferences` missing `RolesGuard`

**File**: `apps/api/src/modules/auth/auth.controller.ts`

```typescript
@Patch('me/preferences')
@UseGuards(JwtAuthGuard)           // ← no RolesGuard
async updatePreferences(...) { ... }
```

Intentionally open to all authenticated users (all roles need to save UI preferences), which is logically correct. However, it diverges from the codebase convention. Consider adding `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` to document the intent explicitly, or add a comment explaining why `RolesGuard` is omitted.

---

### 🔵 Info

#### I-1 — Large component files

- `ContractCard.tsx`: ~320 lines (was already large, PR modified significantly)
- `CollectionsHeader.tsx`: +308 lines (new file)
- `FocusMode.tsx`: +242 lines (new file)

Not blocking, but consider splitting `CollectionsHeader.tsx` if it grows further.

#### I-2 — `pool.service.ts` `findUnique` after claim does not filter `deletedAt: null`

```typescript
return this.prisma.dailyAssignment.findUnique({ where: { id: assignmentId } });
```

`findUnique` doesn't respect soft-delete by default. Low risk (claim only succeeds on live rows), but inconsistent. Consider `findFirst({ where: { id: assignmentId, deletedAt: null } })`.

#### I-3 — Cron error handling ✅

All 4 cron jobs (`runAutoAssign`, `runAutoLock`, `runPoolExpiry`, `runDailySummary`) correctly wrap in try/catch with `Sentry.captureException`. No issues.

#### I-4 — Frontend patterns ✅

All new hooks use `api.get()`/`api.post()` (no raw `fetch`). All mutations call `qc.invalidateQueries()`. DTOs have Thai validation messages. No hardcoded secrets found.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 2 | Block merge |
| 🟡 Warning | 3 | Fix before merge |
| 🔵 Info | 4 | Optional |

The feature architecture is sound: proper guard placement on the new controller, Sentry on all crons, atomic pool-claim, correct `deletedAt` on most queries. Only two rules violations need to be fixed: missing `@Roles()` on settings endpoints (C-1, security risk) and hard delete on a soft-delete model (C-2, audit trail).
