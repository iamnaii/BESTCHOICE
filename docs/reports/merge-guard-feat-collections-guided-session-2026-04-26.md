# Merge Guard Report — feat/collections-guided-session

**Date**: 2026-04-26  
**Branch**: `feat/collections-guided-session`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

## File Changes Summary

86 files changed, 10,193 insertions(+), 3,357 deletions(-)

### New API module: `collections-session`
| File | Purpose |
|------|---------|
| `collections-session.controller.ts` | Guided-session REST endpoints |
| `collections-session.service.ts` | Session lifecycle (start/action/skip/next) |
| `auto-assign.service.ts` | Daily pool auto-assignment algorithm |
| `pool.service.ts` | Unclaimed contract pool list + claim |
| `team-dashboard.service.ts` | Per-collector real-time status |
| `collections-summary.service.ts` | Session completion summary |
| `collections-session.cron.ts` | Daily assignment refresh cron |
| `dto/action.dto.ts`, `dto/skip.dto.ts` | Validated request DTOs |
| `*.spec.ts` (×5) | Unit tests |

### Prisma schema changes
- New models: `DailyAssignment`, `ContractDailySnapshot`, `FilterPreset`, `LegalCase`, `LegalCaseDocument`
- New enums: `AssignmentSource`, `AssignmentStatus`, `AssignmentOutcome`, `SkipReason`, `FilterPresetScope`
- Fields added to `User`: `collectionsActive`, `preferences`

### Frontend changes
- `CollectionsPage/session/` — 7 new components (FocusMode, FocusContractCard, SessionView, etc.)
- `CollectionsPage/components/` — Customer360Panel, ContactLogDialog, DailyProgressStrip, etc.
- `SettingsPage` — CollectionsConfig panel

### Other changes
- `auth.controller.ts` + `auth.service.ts` — `PATCH /auth/me/preferences` endpoint
- `mdm.controller.ts` — `POST /mdm/contracts/:id/lock|unlock` endpoints
- `settings.controller.ts` — `GET/PUT /settings/collections` endpoints
- `docs/plans/` — 3 planning documents added

---

## Issues

### Critical
_None_

---

### Warning

**1. `team-dashboard.service.ts:134` — `Number()` on money field `amountPaid`**

```ts
// apps/api/src/modules/collections-session/team-dashboard.service.ts
const collectedByCollector = new Map(
  todayPayments.map((p) => [p.recordedById!, Number(p._sum.amountPaid ?? 0)]),
);
```

`amountPaid` is a `@db.Decimal(12,2)` field. Using `Number()` directly on a Prisma Decimal aggregate violates the project rule (_"ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน"_). Should be:
```ts
new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()
```
or held as `Prisma.Decimal` until display. Amounts up to ~9,007 trillion are safe with `Number()` due to IEEE 754 precision, but the pattern must remain consistent to avoid future bugs.

**Fix**: `Number(p._sum.amountPaid ?? 0)` → `new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()`

---

**2. `prisma/schema.prisma` — `ContractDailySnapshot` missing `///` exception comment**

```prisma
model ContractDailySnapshot {
  ...
  createdAt   DateTime  @default(now()) @map("created_at")
  // ← no updatedAt, no deletedAt
}
```

The `database.md` rule requires a `///` comment when omitting `updatedAt`/`deletedAt`, e.g.:
```prisma
/// Immutable daily snapshot — updatedAt/deletedAt intentionally omitted; retained via cron
```
Without this, future developers may incorrectly add the fields or flag it as a bug.

**Fix**: Add a `///` doc comment above the model explaining why the fields are omitted.

---

### Info

**3. `auth.controller.ts` — `PATCH /auth/me/preferences` has no `@Roles()` decorator**

```ts
@Patch('me/preferences')
@UseGuards(JwtAuthGuard)   // ← RolesGuard not applied
async updatePreferences(...)
```

This follows the existing pattern of `GET /auth/me` (also no `@Roles()`). The endpoint only touches the requesting user's own UI preferences and is not accessible without a valid JWT. Acceptable given the established pattern, but technically deviates from the _"ทุก method ต้องมี `@Roles(…)`"_ rule.

**Decision**: Accept as-is (consistent with existing `GET /auth/me` — any authenticated user should be able to update their own preferences regardless of role).

---

**4. `any` type in test files**

Multiple `.spec.ts` files use `any` for mock objects:
```ts
let prisma: any;
const prismaMock: any = { ... };
```
This is common in unit tests where full typing of mocks is impractical. No `any` found in production service/controller code. Low risk.

---

**5. Large planning documents in `docs/plans/`**

`docs/plans/2026-04-26-collections-guided-session.md` is 3,873 lines. These are engineering plans/specs and are appropriate for `docs/`. No action needed.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controller | ✅ `CollectionsSessionController` has class-level guards |
| `@Roles()` on all controller methods | ✅ All 7 methods have `@Roles()` |
| New MDM endpoints guarded | ✅ `lockByContract` + `unlockByContract` have `@Roles` |
| Settings endpoints guarded | ✅ Inherit class-level `@Roles('OWNER')` |
| `Number()` on money fields | ⚠️ 1 instance — `team-dashboard.service.ts:134` |
| `deletedAt: null` in new queries | ✅ All `DailyAssignment` queries include `deletedAt: null` |
| Hardcoded secrets/API keys | ✅ None |
| SQL injection (`$queryRaw`) | ✅ None |
| DTO validation on new DTOs | ✅ `ActionDto`, `SkipDto`, `CollectionsConfigDto`, `UpdatePreferencesDto` all validated |
| Thai error messages | ✅ Present in new DTOs |
| New Prisma model timestamps | ✅ `DailyAssignment`, `FilterPreset`, `LegalCase` correct. `ContractDailySnapshot` missing `///` comment |
| File upload validators | ✅ No new file uploads added |

## Recommendation

**⚠️ REVIEW — fix 2 Warning items before merge**

1. Replace `Number(p._sum.amountPaid ?? 0)` with `new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()` in `team-dashboard.service.ts:134`
2. Add `/// Immutable daily snapshot — updatedAt/deletedAt intentionally omitted; retention managed by cron` above the `ContractDailySnapshot` model in `schema.prisma`

Both fixes are one-liners. No architectural concerns — the new module follows project patterns correctly.
