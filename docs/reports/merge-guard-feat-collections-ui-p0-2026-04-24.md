# Merge Guard Report — feat/collections-ui-p0

**Date**: 2026-04-24  
**Branch**: `feat/collections-ui-p0`  
**Author**: Akenarin Kongdach  
**Commits ahead of main**: 90  
**Files changed**: 128 files (+21,662 / −195 lines)  
**Recommendation**: ⚠️ REVIEW — fix 1 Warning before merge

---

## Summary

This is the largest collections-management feature addition in the codebase: queue management, KPI dashboard, analytics, bulk actions, MDM lock flow, contract letters, dunning retry engine, LINE ad-hoc messaging, and a full CollectionsPage multi-tab UI. No **Critical** issues found. One **Warning** requires a role-restriction fix on the presigned upload endpoint before merge.

### Key New Files (TypeScript)

| Layer | New Files |
|-------|-----------|
| API services | `queue.service.ts`, `kpi.service.ts`, `mdm-lock.service.ts`, `timeline.service.ts`, `bulk.service.ts`, `contract-letter.service.ts`, `dunning-retry.service.ts`, `analytics.service.ts` |
| API crons | `broken-promise.cron.ts`, `letter-auto-generate.cron.ts`, `mdm-auto-propose.cron.ts` |
| API DTOs | `queue-query.dto.ts`, `kpi-query.dto.ts`, `bulk.dto.ts`, `send-line-adhoc.dto.ts`, `approve-mdm.dto.ts`, `update-letter-evidence.dto.ts`, `analytics-query.dto.ts` |
| Web hooks | `useCollectionsQueue.ts`, `useCollectionsKpi.ts`, `useCollectionsAnalytics.ts`, `useBulkActions.ts`, `useApprovalQueues.ts`, `useLetterActions.ts`, `useLetterQueue.ts`, `useContactLog.ts`, `useCustomer360.ts`, `useAdHocLine.ts`, +6 more |
| Web pages | `CollectionsPage/` (index + 6 tabs + 11 components), `DunningSettingsPage.tsx` |

---

## Critical Issues — NONE ✅

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on `OverdueController` | ✅ class-level, includes `BranchGuard` |
| `@Roles()` on all new endpoints | ✅ all 22+ new endpoints decorated |
| `SearchController` guards | ✅ `JwtAuthGuard + RolesGuard` at class level |
| `$queryRaw` parameterized | ✅ all 5 uses in analytics.service.ts use tagged template literals (no string interpolation) |
| `$queryRawUnsafe` | ✅ not used |
| Hardcoded secrets | ✅ none found |
| `deletedAt: null` on new queries | ✅ consistently applied across all new service code |
| `Number()` on Prisma Decimal money fields | ✅ `Number()` only converts `bigint` COUNT values from raw SQL; money Decimal fields use `.toNumber()` after Decimal arithmetic |

---

## Warning Issues — 1 found ⚠️

### W1 — `shop-upload.controller.ts`: Missing `RolesGuard` + `@Roles()` on presigned upload endpoint

**File**: `apps/api/src/modules/storage/shop-upload.controller.ts`  
**Current**:
```ts
@Controller('shop/upload')
@UseGuards(JwtAuthGuard)   // ← RolesGuard absent
export class ShopUploadController {
  @Post('signed-url')
  async presign(@Body() dto: PresignedUploadDto) { ... }
}
```

**Problem**: The branch adds 5 new `UploadKind` values including `MDM_WALLPAPER` and `LETTER_SIGNATURE`. Any authenticated user (including `SALES` role) can currently request a presigned upload URL for these privileged kinds. MDM wallpapers should be restricted to `OWNER`/`FINANCE_MANAGER`.

**Suggested fix**:
```ts
@Controller('shop/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopUploadController {
  @Post('signed-url')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async presign(@Body() dto: PresignedUploadDto) { ... }
}
```
Or add role-based kind validation inside the method (e.g. only `OWNER`/`FINANCE_MANAGER` may request `MDM_WALLPAPER`).

---

### W2 — `assign-collector.dto.ts`: Thai message downgraded

**File**: `apps/api/src/modules/overdue/dto/assign-collector.dto.ts`  
**Before (main)**: `@IsString({ message: 'กรุณาระบุผู้รับผิดชอบติดตาม' })`  
**After (branch)**: `@IsString({ message: 'assignedToId ต้องเป็น string' })`  

The error message changed from user-friendly Thai to a technical field name. Minor but inconsistent with codebase convention.

---

### W3 — `queue.service.ts`: `any` types on internal methods

**File**: `apps/api/src/modules/overdue/queue.service.ts`  
Two private methods use `any`:
```ts
private async enrichRows(contracts: any[], now: Date) { ... }
private toRow(c: any, now: Date) { ... }
```
Should be typed with the Prisma-generated contract type or a local interface.

---

### W4 — `fetch()` used directly for S3 presigned URL uploads

**Files**: Multiple hooks in `CollectionsPage/hooks/`  
`fetch(presigned.uploadUrl, { method: 'PUT', body: file })` is used to upload files directly to S3.  
This is **technically acceptable** — presigned S3 URLs cannot use the `api.get()`/`api.post()` client (which adds JWT headers). However, this pattern isn't documented in the frontend rules.  
**Action**: Add a comment or helper to clarify this is intentional S3 direct upload, not an API call.

---

## Info Items ℹ️

| Item | Detail |
|------|--------|
| `overdue.controller.ts` 521 lines | Doubled in size (was 255). Consider extracting `LetterController`, `MdmController` sub-controllers. Not blocking but impacts maintainability. |
| `overdue.service.ts` 1,062 lines | Grew from 985 — minimal change. Pre-existing size issue. |
| `OverduePage.tsx` 991 lines | Pre-existing legacy file, not changed significantly in this branch. |
| `queue.service.ts` 577 lines | New file — reasonable for the scope, but boundary with `kpi.service.ts` is blurry. |
| Font + image `fetch()` in `letterPdfRenderer.ts` | `fetch('/fonts/...')` and `fetch(url)` used in PDF renderer utility. Acceptable for binary/font loading in browser context (no JWT auth needed). |

---

## Test Coverage

- New services covered: `queue.service.spec.ts`, `kpi.service.spec.ts`, `bulk.service.spec.ts`, `dunning-engine.service.spec.ts`, `dunning-retry.service.spec.ts`, `contract-letter.service.spec.ts`, `mdm-lock.service.spec.ts`, `analytics.service.spec.ts`
- Cron tests: `broken-promise.cron.spec.ts`, `letter-auto-generate.cron.spec.ts`, `mdm-auto-propose.cron.spec.ts`
- DTO spec: `update-letter-evidence.dto.spec.ts`
- Foundation seed spec: `collections-foundation.seed.spec.ts`

Test coverage appears solid. The `any` types in queue.service.ts reduce test inference quality.

---

## Recommendation

**⚠️ REVIEW** — address W1 (missing RolesGuard on upload endpoint) before merge.  
W2 and W3 are low-risk but should be fixed in a follow-up commit.  
No Critical blockers. Security posture is strong: all business endpoints are guarded, raw SQL is parameterized, deletedAt filtering is consistent.
