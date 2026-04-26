# Merge Guard Report — feat/collections-guided-session

**Date**: 2026-04-26  
**Branch**: `feat/collections-guided-session`  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local)  
**Latest commit**: `3b42f2f3` — feat(collections): owner team-overview dashboard MVP  
**Commits ahead of main**: 46  
**Recommendation**: 🟡 **REVIEW** — fix 3 warnings before merge

---

## File Changes Summary

82 files changed — 10,211 insertions / 2,637 deletions

Key additions:
- `apps/api/src/modules/collections-session/` — new NestJS module (controller, 5 services, 4 spec files, cron, 2 DTOs)
- `apps/api/prisma/schema.prisma` — new `DailyAssignment` model + 4 new enums + 2 new migrations
- `apps/web/src/pages/CollectionsPage/session/` — 6 new frontend components (PreStartScreen, SessionView, SessionSummary, SessionTimer, SessionProgress, SkipReasonDialog)
- `apps/web/src/pages/SettingsPage/components/CollectionsConfigCard.tsx` — new settings card
- `apps/api/src/modules/mdm/` — 2 new contract-scoped lock/unlock endpoints
- `apps/api/src/modules/auth/auth.controller.ts` — new `PATCH /auth/me/preferences` endpoint

---

## Security Checks

| Check | Result |
|-------|--------|
| `CollectionsSessionController` — `@UseGuards(JwtAuthGuard, RolesGuard)` at class level | ✅ Pass |
| `CollectionsSessionController` — `@Roles()` on all 7 methods | ✅ Pass |
| `MdmController` — class-level guards cover new `lockByContract`/`unlockByContract` | ✅ Pass |
| `SettingsController` — class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER')` covers new endpoints | ✅ Pass |
| `PATCH /auth/me/preferences` — method-level `@UseGuards(JwtAuthGuard)`, consistent with other `/me` endpoints (no class-level guard on auth controller) | ✅ Pass |
| `DailyAssignment` model — `deletedAt DateTime?` present | ✅ Pass |
| `DailyAssignment` model — UUID id, createdAt/updatedAt/deletedAt timestamps | ✅ Pass |
| `$queryRaw` unparameterized SQL | ✅ None found |
| Hardcoded secrets/API keys | ✅ None found |
| All new Prisma queries in service files include `deletedAt: null` | ⚠️ See Warning #3 |

---

## Issues

### Warning

**W-001 — `Number()` on Decimal money field**  
File: `apps/api/src/modules/collections-session/team-dashboard.service.ts:78`

```typescript
// Line 78 — amountPaid is Decimal(@db.Decimal(12,2))
const collectedByCollector = new Map(
  todayPayments.map((p) => [p.recordedById!, Number(p._sum.amountPaid ?? 0)]),
);
```

`Payment.amountPaid` is `@db.Decimal(12,2)`. Converting with `Number()` can lose precision on amounts ≥ 2^53 (not a real-world risk for THB) but violates the project-wide Decimal policy established in v2/v4 hardening. The result populates `TeamDashboardResponse.totalCollected: number` which is display-only (not used in journal entries), so financial impact is minimal.

**Fix**: Replace with `new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()` and add a comment noting this is display-only.

---

**W-002 — `role: 'SALES' as any` bypasses enum type safety**  
File: `apps/api/src/modules/collections-session/team-dashboard.service.ts:46`

```typescript
where: {
  role: 'SALES' as any,   // <-- should use Role enum
  ...
}
```

Same pattern appears in `auto-assign.service.ts`. Importing `Role` from `@prisma/client` and using `Role.SALES` gives compile-time safety.

**Fix**:
```typescript
import { Role } from '@prisma/client';
// ...
role: Role.SALES,
```

---

**W-003 — `runAutoLock` cron missing `deletedAt: null` filter**  
File: `apps/api/src/modules/collections-session/collections-session.cron.ts:42`

```typescript
const result = await this.prisma.dailyAssignment.updateMany({
  where: { date: today, lockedAt: null, status: 'PENDING' },
  //       ^ missing: deletedAt: null
  data: { lockedAt: new Date() },
});
```

Soft-deleted assignments would have `lockedAt` set. Consistent with `runPoolExpiry` cron which also omits `deletedAt: null` in its where clause. Low runtime impact since soft-deletes on assignments should be rare, but violates the project-wide soft-delete query rule.

**Fix**: Add `deletedAt: null` to both `runAutoLock` and `runPoolExpiry` where clauses.

---

### Info

**I-001 — Large doc-plan files committed in code diff**  
Files: `docs/plans/2026-04-26-collections-guided-session.md` (3,873 lines) and two others (591, 448 lines).  
These are planning documents, not production code. Recommend moving to a separate docs branch or confirming they're intentionally included.

**I-002 — New session components well within size limits**  
`PreStartScreen.tsx` (155 lines), `SessionView.tsx` (143 lines), `SessionSummary.tsx` (153 lines) — all under the 500-line guideline.

**I-003 — All 4 cron jobs have proper Sentry.captureException**  
`runAutoAssign`, `runAutoLock`, `runPoolExpiry`, `runDailySummary` — all capture exceptions to Sentry with appropriate tags. ✅

---

## Overall Assessment

The branch is well-structured. New controller follows security patterns correctly. DailyAssignment model has proper timestamps and indexes. All cron jobs capture to Sentry. Test coverage is solid (4 spec files, 220+114+93+92 tests across services).

Three warnings should be fixed before merge:
1. Replace `Number()` with proper Decimal handling in `team-dashboard.service.ts` (W-001)
2. Replace `as any` role casts with `Role` enum imports (W-002)
3. Add `deletedAt: null` to auto-lock and pool-expiry cron where clauses (W-003)

**Recommendation**: 🟡 **REVIEW** — three warnings, no critical issues.
