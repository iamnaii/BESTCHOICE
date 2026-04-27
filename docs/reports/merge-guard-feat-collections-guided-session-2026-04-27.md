# Pre-Merge Guard Report — feat/collections-guided-session

**Date**: 2026-04-27  
**Branch**: `feat/collections-guided-session`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

```
86 files changed, 10193 insertions(+), 3357 deletions(-)
```

Major areas touched:

| Area | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | New enums (AssignmentSource/Status/Outcome, SkipReason) + `DailyAssignment` model + `collectionsActive`/`preferences` on User |
| `apps/api/prisma/migrations/` | 2 new migrations |
| `apps/api/src/modules/collections-session/` | New module: controller, 4 services, 2 spec files, 2 DTOs |
| `apps/api/src/modules/mdm/` | New MDM lock endpoints (batch lock/unlock/status by collector) |
| `apps/api/src/modules/settings/` | New CollectionsConfig settings endpoint |
| `apps/api/src/modules/overdue/` | Minor queue service refactor + queue-query DTO fix |
| `apps/api/src/modules/auth/` | New `PATCH /auth/preferences` endpoint |
| `apps/web/src/pages/CollectionsPage/` | Full redesign: removed bulk-action bar, added guided session mode (FocusMode, SessionView, PoolBrowser, PreStartScreen, SessionSummary, SessionTimer) |
| `apps/web/src/pages/SettingsPage/` | New CollectionsConfigCard component |
| `apps/web/e2e/` | New E2E spec: `collections-session.spec.ts` |

---

## Issues by Severity

### Critical
_None found._

### Warning

**1. `Number()` on Decimal financial field — `team-dashboard.service.ts`**

```typescript
// apps/api/src/modules/collections-session/team-dashboard.service.ts
const collectedByCollector = new Map(
  todayPayments.map((p) => [p.recordedById!, Number(p._sum.amountPaid ?? 0)]),
);
```

`p._sum.amountPaid` is a `Prisma.Decimal | null` aggregate. Calling `Number()` directly converts via string coercion, which works but bypasses the project's strict `Prisma.Decimal` arithmetic rule and loses precision for large values.

**Fix**: Use `new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()`.

This value is only used for a team dashboard display metric (`collectedToday: number`) and is never persisted, so risk of data corruption is low — but it violates the project convention.

### Info

- **`team-dashboard.service.ts` — `totalCollected`** — The final `totalCollected` in the response is accumulated as a plain `number` via `reduce((s, c) => s + c.collectedToday, 0)`. This is a second-order consequence of the Warning above. Once the Warning is fixed, this accumulation should also switch to Decimal arithmetic before serialising.

- **`auth.controller.ts` — new `PATCH /auth/preferences` endpoint** — Correctly guarded with `@UseGuards(JwtAuthGuard)`. No `@Roles()` decorator present (any authenticated user can update their preferences), which appears intentional for a personal preferences endpoint. Confirm this is intended scope.

- **`DailyAssignment` model** — No formal Prisma `@relation` on `paymentId` (intentional — stored as a loose String reference to avoid FK constraint on a nullable link). Comment explaining this would improve future maintainability.

- **Removed files** — `ApprovalPendingRow.tsx`, `BulkActionBar.tsx`, `BulkSlipUploadDialog.tsx`, `CollectionsKpiStrip.tsx`, `DailyProgressStrip.tsx`, `LateFeeWaiverApprovalRow.tsx`, `LetterQueueSection.tsx`, `LineRetryQueueSection.tsx` — and their hooks (`useApprovalQueues.ts`, `useBulkActions.ts`, `useBulkSelection.ts`). The `ApprovalTab.tsx` and `FollowUpTab.tsx` tabs are also removed. Confirm these features are permanently dropped (not just moved) before merging.

---

## Positive Findings

- `collections-session.controller.ts` correctly declares `@UseGuards(JwtAuthGuard, RolesGuard)` at the class level with `@Roles()` on every method.
- New `DailyAssignment` model includes all required fields: `createdAt`, `updatedAt`, `deletedAt` — proper soft-delete pattern.
- New DTOs (`ActionDto`, `SkipDto`) use class-validator with Thai error messages on all required fields.
- All frontend mutations use `@tanstack/react-query` `useMutation` with `onSuccess: () => queryClient.invalidateQueries(...)` — no raw `fetch()` calls found.
- All new Prisma queries include `deletedAt: null` filters.
- `auto-assign.service.ts` implements assignment deduplication via `@@unique([date, contractId])` — prevents double-assignment.
- 519+ lines of new unit tests across 3 spec files (`auto-assign.service.spec.ts`, `collections-session.service.spec.ts`, `collections-summary.service.spec.ts`, `pool.service.spec.ts`).
- New E2E spec covers session start, focus mode navigation, and session summary.
- Timezone-aware `bangkokStartOfDay()` utility used consistently throughout new services — no raw `new Date()` for day boundaries.

---

## Recommendation

**⚠️ REVIEW**

One Warning-level Decimal violation in `team-dashboard.service.ts`. The rest of the feature is well-structured, properly guarded, and has good test coverage.

**Required before merge:**

1. Fix `Number(p._sum.amountPaid ?? 0)` → `new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()` in `team-dashboard.service.ts` (and the downstream `reduce` accumulation).
2. Confirm intentional removal of bulk-action, approval queue, and follow-up tab features.

Once these are addressed, the branch is safe to merge.
