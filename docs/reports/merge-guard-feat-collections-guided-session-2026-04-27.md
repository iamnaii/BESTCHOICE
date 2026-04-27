# Merge Guard Report — feat/collections-guided-session

**Date**: 2026-04-27  
**Branch**: `feat/collections-guided-session`  
**Author**: Akenarin Kongdach  
**Commits**: 49  
**Diff**: ~50 files, +3 000 / -1 500 (est.)  
**Recommendation**: ⚠️ REVIEW — fix 2 Warning items before merge

---

## Summary

Large feature branch introducing a guided collections workflow:

- New NestJS module `collections-session` (controller, service, pool service,
  team-dashboard service, auto-assign service, cron, 5 spec files, 2 DTOs)
- `DailyAssignment` + `ContractDailySnapshot` Prisma models + 2 migrations
- `auth/me/preferences` PATCH endpoint for persisting per-user UI state
- Settings endpoints `GET/PUT /settings/collections` for tuning knobs
- New MDM contract-based lock/unlock endpoints
- Collections UI overhaul (ContractCard, ContactLogDialog, CollectionsHeader,
  Customer360Panel, Customer360Actions, new tabVisibility tests, E2E spec)
- `User.collectionsActive` flag + `User.preferences` Json field

---

## File Changes (selected)

| Area | Key files | Notes |
|------|-----------|-------|
| API: new module | `collections-session/*.ts` | 7 services + cron + 2 DTOs |
| API: auth | `auth.controller.ts`, `auth.service.ts` | PATCH me/preferences |
| API: settings | `settings.controller.ts`, `settings.service.ts` | collections config |
| API: mdm | `mdm.controller.ts`, `mdm.service.ts` | lock/unlock by contractId |
| Schema | `schema.prisma` + 2 migrations | DailyAssignment, ContractDailySnapshot |
| Frontend | `CollectionsPage/**` (many components) | major UI rework |
| Tests | 5 new spec files (API), 1 E2E spec | |

---

## Issues by Severity

### Critical
_None_

### Warning

**W-1 — `Number()` on financial aggregate sum** (`team-dashboard.service.ts`)

```typescript
// Line ~60 in team-dashboard.service.ts
const collectedByCollector = new Map(
  todayPayments.map((p) => [p.recordedById!, Number(p._sum.amountPaid ?? 0)]),
);
```

`_sum.amountPaid` is a `Decimal` field. Converting with `Number()` loses precision for
amounts > 2^53. Per codebase rules, use `new Prisma.Decimal(p._sum.amountPaid ?? 0)`.
This is a display/analytics context, but the rule applies uniformly.

**Fix**: Replace `Number(p._sum.amountPaid ?? 0)` with
`new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()` (or keep as Decimal if stored
in a map that later feeds into arithmetic).

---

**W-2 — Missing `deletedAt: null` on `recentAssignments` query** (`auto-assign.service.ts`)

```typescript
const recentAssignments = await this.prisma.dailyAssignment.findMany({
  where: {
    date: { gte: addDays(dateOnly, -RECENT_RELATIONSHIP_DAYS) },
    collectorId: { not: null },
    // ← missing deletedAt: null
  },
  ...
});
```

`DailyAssignment` has `deletedAt DateTime?`. This relationship-history query will
include soft-deleted assignments, which could bias the round-robin collector affinity
map toward collectors who had their assignments removed.

**Fix**: Add `deletedAt: null` to the `where` clause.

---

### Info

- `CollectionsSessionController` uses `user: any` for `@CurrentUser()` param (lines 24, 29,
  35, 40, 47, 53, 60). This is consistent with other controllers in the codebase but
  warrants a typed interface (e.g. `{ id: string; role: string; branchId?: string }`).
- `formatBahtCompact()` in `CollectionsHeader.tsx` uses `Number(decimalString)` — display
  only, no arithmetic, acceptable but inconsistent with Decimal rules.
- 4 large spec files use `any` extensively for mock objects (test-only scope, acceptable).
- `ContractCard.tsx` and `ContactLogDialog.tsx` are both 370-500 lines — approaching
  the 500-line soft limit, consider splitting if more logic is added.

---

## Security Checklist

- [x] `CollectionsSessionController` — `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
- [x] `@Roles()` on every endpoint in `CollectionsSessionController` ✓
- [x] `SettingsController` — new endpoints inherit `@Roles('OWNER')` from class ✓
- [x] `MdmController` — new lock/unlock endpoints have `@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES')` ✓
- [x] `PATCH /auth/me/preferences` — `@UseGuards(JwtAuthGuard)` present ✓
- [x] DTOs validated: `ActionDto`, `SkipDto`, `UpdatePreferencesDto`, `CollectionsConfigDto` all have class-validator decorators with Thai messages ✓
- [x] Cron jobs: all 4 have `Sentry.captureException` in catch blocks ✓
- [x] No `$queryRaw` / SQL injection vectors ✓
- [x] No hardcoded secrets ✓
- [x] `contract.findMany` in `auto-assign.service.ts` includes `deletedAt: null` ✓
- [ ] **`dailyAssignment.findMany` (recentAssignments) missing `deletedAt: null`** ← W-2
- [ ] **`Number(p._sum.amountPaid)` on Decimal sum** ← W-1
