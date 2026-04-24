# Merge Guard Report — feat/collections-hardening

**Date**: 2026-04-24  
**Branch**: `feat/collections-hardening`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

```
89 files changed, 15,984 insertions(+), 184 deletions(-)
```

This branch is a superset of `feat/collections-workflow-hub` plus additional hardening:
- `apps/api/src/modules/overdue/bulk.service.ts` — bulk assign/lock/send
- `apps/api/src/modules/overdue/timeline.service.ts` — full contract timeline
- `apps/api/src/modules/storage/shop-upload.controller.ts` — presigned upload URL endpoint
- `apps/web/src/pages/CollectionsPage/components/BulkActionBar.tsx` — bulk action UI
- `apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx` — letter dispatch
- `apps/web/src/pages/DunningSettingsPage.tsx` — dunning rule management page
- MDM auto-propose cron + letter-auto-generate cron
- 89 total files, 50+ test files covering new services

---

## Issues by Severity

### ✅ Critical — None Found

- `OverdueController` has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` ✓
- Every overdue endpoint has `@Roles(...)` ✓
- No unparameterized `$queryRaw` (all use Prisma tagged template literals) ✓
- No `Number()` on monetary fields ✓
- All new Prisma queries include `deletedAt: null` ✓
- No hardcoded secrets ✓

---

### ⚠️ Warning — Should Fix Before Merge

**W-1: `ShopUploadController` missing `RolesGuard` and `@Roles()`** (`apps/api/src/modules/storage/shop-upload.controller.ts`)

```ts
@Controller('shop/upload')
@UseGuards(JwtAuthGuard)           // ← only JwtAuthGuard, no RolesGuard
export class ShopUploadController {

  @Post('signed-url')
  // ← no @Roles() decorator
  async presign(@Body() dto: PresignedUploadDto) {
```

**Risk**: Any authenticated user — including `SALES` staff — can generate presigned S3 upload URLs for sensitive upload kinds: `LETTER_PDF`, `LETTER_SIGNATURE`, `LETTER_LETTERHEAD`, `MDM_WALLPAPER`. A SALES user could overwrite the MDM lock-screen wallpaper or letter signature image.

Per project security rules: *"ทุก controller ต้องมี `@UseGuards(JwtAuthGuard, RolesGuard)` ที่ class level, ทุก method ต้องมี `@Roles(...)` decorator"*.

**Fix**:
```ts
@Controller('shop/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopUploadController {

  @Post('signed-url')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  async presign(@Body() dto: PresignedUploadDto) {
```
If SALES legitimately needs BANK_SLIP / REVIEW_PHOTO uploads, use `@Roles()` with the full set or split into two endpoints with different role requirements.

---

**W-2: Inline body parameters bypass class-validator** (`overdue.controller.ts`)

Inherited from `collections-workflow-hub` — see W-1 in that report. Same 8 endpoints with raw `@Body() body: { ... }` inline types have no class-validator enforcement.

---

**W-3: `SendLineAdHocDto` allows empty payload** (`dto/send-line-adhoc.dto.ts`)

Inherited from `collections-workflow-hub` — both `templateId` and `customMessage` are optional with no at-least-one constraint. Empty payload silently passes validation.

---

### ℹ️ Info

**I-1: Large files**
- `overdue.service.ts`: 1,062 lines — serviceable but approaching God Class territory. Letter and MDM logic are now in dedicated services; remaining candidates for extraction: escalation logic, promise-to-pay tracking.
- `OverduePage.tsx`: 991 lines
- `DunningSettingsPage.tsx`: 767 lines

**I-2: `rejectMdmLock` and `unlockMdm` inline reason validation**

```ts
@Post('mdm-requests/:id/reject')
rejectMdmLock(@Param('id') id: string, @Body() body: { reason: string }, ...) {
```

No min-length enforced. An empty `reason: ""` will be written to the audit log. Minor, but covered under W-2.

**I-3: Seed integration tests need live DB**

`apps/api/src/modules/overdue/__tests__/collections-foundation.seed.spec.ts` instantiates `PrismaClient` directly. Will fail in unit-test CI without a DB. Guard with an env check or move to `e2e/`.

---

## Positive Notes

- `BulkActionBar` uses `useQuery` for staff list lookup (`api.get('/users')`) — correct pattern ✓
- `useContactLog`, `useCollectionsQueue`, `useApprovalQueues` all use `api.*` from `@/lib/api` ✓
- `invalidateQueries` called after every mutation ✓
- `BulkAssignDto`, `BulkSendLineDto`, `BulkProposeLockDto` have proper array size limits (1-100) ✓
- `ArrayMaxSize(100)` prevents bulk abuse ✓
- MDM cron checks `mdm_auto_propose_enabled` SystemConfig before running ✓
- Letter cron checks `letter_auto_generate_enabled` and defaults to off ✓
- 40+ new test files across services ✓
- `timeline.service.spec.ts` covers happy path + error cases ✓

---

## Recommendation

**⚠️ REVIEW** — W-1 (missing RolesGuard on `ShopUploadController`) is the most important fix before merge. It allows any logged-in user to overwrite sensitive S3 assets used for MDM lock screens and legal letters.

W-2 and W-3 (inline body DTOs and empty ad-hoc DTO) are lower-risk but should be addressed to prevent silent failures in the dunning audit trail.

Priority fix order: W-1 → W-2 → W-3.
