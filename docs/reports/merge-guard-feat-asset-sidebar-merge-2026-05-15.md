# Merge Guard Report — feat/asset-sidebar-merge

**Date**: 2026-05-15  
**Branch**: `feat/asset-sidebar-merge`  
**Authors**: Akenarin Kongdach, iamnaii  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/asset/__tests__/asset-global-audit.spec.ts` | +151 |
| `apps/api/src/modules/asset/asset.controller.ts` | +20 |
| `apps/api/src/modules/asset/asset.service.ts` | +88 |
| `apps/web/src/App.tsx` | +9 |
| `apps/web/src/components/layout/Sidebar.tsx` | +191 / -86 |
| `apps/web/src/config/menu.ts` | +42 / -3 |
| `apps/web/src/hooks/useDraftAssetCount.ts` | +14 (new) |
| `apps/web/src/pages/assets/AssetAuditPage.tsx` | +78 / -8 |
| `apps/web/src/pages/assets/__tests__/AssetAuditPage.global.test.tsx` | +51 (new) |
| `apps/web/src/pages/assets/api.ts` | +18 |
| `apps/web/src/pages/assets/types.ts` | +12 |

**Total**: 588 insertions, 86 deletions across 11 files

---

## Issues Found

### Critical — None

### Warning

**W1 — `asset.service.ts` exceeds 500-line threshold (1,299 lines)**  
File: `apps/api/src/modules/asset/asset.service.ts:1-1299`  
The service has grown to 1,299 lines across multiple concerns (CRUD, depreciation, transfers, disposals, audit). Not a merge blocker but the file should be split into focused sub-services (e.g., `asset-audit.service.ts`) in a follow-up.

**W2 — `fixedAsset.findMany` intentionally skips `deletedAt: null` (documented rule deviation)**  
File: `apps/api/src/modules/asset/asset.service.ts` (new `listGlobalAudit` method)  
```ts
// Intentional: audit history must show assetCode/assetName even for soft-deleted
// (deletedAt != null) assets. Project rule deviation acknowledged.
await this.prisma.fixedAsset.findMany({ where: { id: { in: assetIds } }, ... })
```
The deviation is correctly documented with a comment. Audit logs must reference deleted assets by name — this is architecturally sound. Acceptable as-is.

### Info

**I1 — `as any` used in test constructor**  
File: `apps/api/src/modules/asset/__tests__/asset-global-audit.spec.ts`  
```ts
const realService = new (AssetService as any)(prisma as unknown as PrismaService);
```
Normal test workaround for DI. Acceptable in test context.

**I2 — `parseInt` on pagination query params (acceptable)**  
File: `apps/api/src/modules/asset/asset.controller.ts`  
```ts
const parsedPage = page ? parseInt(page, 10) : undefined;
```
Correct use — parsing string query params to integers for pagination. Not a financial field.

---

## Security Check

- `@UseGuards(JwtAuthGuard, RolesGuard)` present on `AssetController` class (inherited)  
- `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on new `GET /assets/audit` endpoint — `BRANCH_MANAGER` explicitly excluded with rationale (cross-branch audit exposure)  
- No hardcoded secrets  
- No raw `$queryRaw`  
- No `fetch()` calls bypassing `api.*`  

---

## Verdict

**✅ APPROVE** — Clean addition of global audit feed with proper guards, documented intentional `deletedAt` deviation, and tests included. Service file size is the only forward-looking concern; not a blocker.
