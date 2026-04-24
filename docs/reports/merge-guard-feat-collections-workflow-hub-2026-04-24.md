# Merge Guard Report — feat/collections-workflow-hub

**Date**: 2026-04-24  
**Branch**: `feat/collections-workflow-hub`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

```
56 files changed, 8,904 insertions(+), 179 deletions(-)
```

**Key new files:**
- `apps/api/src/modules/overdue/overdue.controller.ts` — updated with 13 new endpoints
- `apps/api/src/modules/overdue/queue.service.ts` — collections queue service
- `apps/api/src/modules/overdue/kpi.service.ts` — KPI aggregation service
- `apps/api/src/modules/overdue/dunning-engine.service.ts` — dunning state machine
- `apps/api/src/modules/overdue/mdm-lock.service.ts` — MDM lock/unlock workflow
- `apps/api/src/modules/overdue/timeline.service.ts` — contract timeline
- `apps/api/src/modules/overdue/dto/bulk.dto.ts` — bulk action DTOs
- `apps/api/src/modules/overdue/dto/send-line-adhoc.dto.ts` — ad-hoc LINE message DTO
- `apps/web/src/pages/CollectionsPage/` — full new page (index + 5 tabs + 5 components + 5 hooks)
- `apps/api/prisma/seeds/collections-foundation.seed.ts` — seed for dunning rules
- `apps/api/scripts/backfill-no-answer-count.ts` — one-time backfill script

---

## Issues by Severity

### ✅ Critical — None Found

- `OverdueController` has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level ✓
- Every new endpoint has `@Roles(...)` decorator ✓
- No `Number()` on monetary fields — all Decimal arithmetic uses `.sub()` / `.add()` / `.toNumber()` only for display serialization ✓
- All new Prisma queries include `where: { deletedAt: null }` ✓
- No hardcoded secrets or API keys ✓
- `$queryRaw` in `backfill-no-answer-count.ts` uses Prisma tagged template literal — parameterized, safe ✓

---

### ⚠️ Warning — Should Fix Before Merge

**W-1: Inline body parameters bypass class-validator** (`overdue.controller.ts`)

Multiple endpoints accept raw inline body objects without DTO classes:

```ts
// Line 178 — no validation on hoursFromNow
@Body() body: { hoursFromNow?: number }

// Line 314, 340, 443, 453 — no @IsString(), no @IsNotEmpty()
@Body() body: { reason: string }

// Line 414 — no @IsUrl(), no @IsNotEmpty()
@Body() body: { pdfUrl: string }

// Line 424 — no validation on trackingNumber or evidencePhotoUrl
@Body() body: { trackingNumber: string; evidencePhotoUrl?: string }
```

**Risk**: If `reason` is `undefined` or an empty string, it passes class-validator silently. The service layer may write empty strings to the DB audit log or throw at runtime.

**Fix**: Extract each inline body into a named DTO class in `dto/` with `@IsString()` and `@IsNotEmpty()` (Thai error message).

---

**W-2: `SendLineAdHocDto` allows empty payload** (`dto/send-line-adhoc.dto.ts`)

Both `templateId` and `customMessage` are `@IsOptional()` with no mutual-exclusion or at-least-one validation. A request with an empty body will pass validation and reach the service, which may attempt to send a blank LINE message.

```ts
// Both optional — empty body passes validation
export class SendLineAdHocDto {
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() @MinLength(10) customMessage?: string;
}
```

**Fix**: Add a custom validator or `@ValidateIf`/`@IsNotEmpty` on one field, or use a discriminated union DTO approach. At minimum, throw `BadRequestException` in the service if both are undefined.

---

### ℹ️ Info

**I-1: `overdue.service.ts` is 1,062 lines** — consider extracting letter/MDM logic into the dedicated services once they stabilise (contract-letter.service, mdm-lock.service).

**I-2: `OverduePage.tsx` is 991 lines** — existing file, now ~991 lines. Not blocking.

**I-3: `collections-foundation.seed.ts` test lives under `src/modules/overdue/__tests__/`** — seed integration tests that require a live DB may fail in unit-test CI. Consider adding a skip guard (`if (!process.env.DATABASE_URL) return`) or moving to an `e2e/` directory.

---

## Positive Notes

- All frontend hooks use `api.get()` / `api.patch()` from `@/lib/api` (no raw `fetch`) ✓
- `useContactLog` calls `queryClient.invalidateQueries()` after mutation ✓
- `QueryBoundary` wraps all data list views ✓
- `useDebounce` used for search inputs ✓
- Seed is idempotent (upsert + `skipDuplicates`) ✓
- `DunningRule` event rules seeded with `isActive: false` in production — safe default ✓
- Thai validation messages present on all DTO decorators that have explicit messages ✓
- Tests added: `overdue.service.spec.ts`, `queue.service.spec.ts`, `dunning-engine.service.spec.ts`, `kpi.service.spec.ts`, `mdm-lock.service.spec.ts`

---

## Recommendation

**⚠️ REVIEW** — Safe to merge after fixing W-1 and W-2.  
No critical security blockers. The inline body parameters and empty DTO are the primary concerns — they risk silent failures in the service layer for MDM reject/unlock and ad-hoc LINE send paths.
