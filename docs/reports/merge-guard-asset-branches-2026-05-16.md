# Pre-Merge Guard Report — Asset Feature Branches
**Date**: 2026-05-16  
**Branches reviewed**: 3 (most recent unmerged, as of 2026-05-15 15:22 BKK)

---

## Branches Reviewed

| Branch | Last Commit | Files Changed | Lines |
|--------|-------------|---------------|-------|
| `feat/asset-sidebar-merge` | 2026-05-15 15:08 | 11 changed | +588 / -86 |
| `feat/asset-ui-polish-pr2a` | 2026-05-15 15:20 | 28 changed | +2,372 / -281 |
| `feat/asset-ui-polish-pr2b` | 2026-05-15 15:22 | 12 changed | +1,019 / -94 |

---

## feat/asset-sidebar-merge

### Summary
Adds a global asset audit feed (`GET /assets/audit`), wires a DRAFT-count badge into the sidebar, and introduces `AssetAuditPage` global mode.

### File Changes
- `apps/api/src/modules/asset/asset.controller.ts` — new `@Get('audit')` endpoint
- `apps/api/src/modules/asset/asset.service.ts` — `listGlobalAudit()` implementation
- `apps/api/src/modules/asset/__tests__/asset-global-audit.spec.ts` — 151 LOC test coverage
- `apps/web/src/components/layout/Sidebar.tsx` — DRAFT count badge integration
- `apps/web/src/hooks/useDraftAssetCount.ts` — new hook
- `apps/web/src/pages/assets/AssetAuditPage.tsx` — global audit mode
- Other: App.tsx routing, menu.ts, api.ts, types.ts

### Issues

#### Critical
_None found._

#### Warning
_None found._

#### Info
1. **`as any` in test file** (`asset-global-audit.spec.ts:151`)  
   `new (AssetService as any)(prisma as unknown as PrismaService)` — standard NestJS unit test pattern to construct service without full DI. Acceptable.

2. **Intentional `deletedAt` omission** (`asset.service.ts`, `listGlobalAudit`)  
   The batch asset lookup inside `listGlobalAudit` omits `where: { deletedAt: null }` — intentional and documented with inline comment: *"Intentional: audit history must show assetCode/assetName even for soft-deleted assets."* Consistent with audit trail requirements.

3. **BRANCH_MANAGER excluded from `/assets/audit`**  
   `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` — BRANCH_MANAGER intentionally excluded per `CROSS_BRANCH_ROLES` policy (global audit exposes cross-branch data). Comment documents the decision.

### Security Checks
- ✅ Class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on `AssetController`
- ✅ All new endpoint methods have `@Roles()` decorator
- ✅ No hardcoded secrets or API keys
- ✅ No raw `fetch()` in frontend
- ✅ No `Number()` on money fields

### Recommendation: **APPROVE** ✅

---

## feat/asset-ui-polish-pr2a

### Summary
Adds vendor master FK link (`vendorId`) + partial-payment field (`vendorAmountPaid: Decimal`) to `FixedAsset`. Replaces single-approver UI with multi-user `permissionConfig` (JSONB array). Adds 3 migrations, 3 new test files.

### File Changes
- `apps/api/prisma/schema.prisma` — `FixedAsset.vendorId`, `vendorAmountPaid Decimal?`, `permissionConfig Json`
- `apps/api/src/modules/asset/asset.service.ts` — `create`/`update`/`copy` extended
- `apps/api/src/modules/asset/dto/create-asset.dto.ts` — `PermissionConfigEntryDto`, new fields
- `apps/api/src/modules/suppliers/suppliers.controller.ts` — expanded `@Roles` on POST
- `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx` — vendor quick-add inline form
- `apps/web/src/pages/assets/components/AssetEntrySection5Permission.tsx` — replaces `AssetEntrySection5Approver.tsx`
- Multiple: `AssetsListPage.tsx`, `AssetEntryPage.tsx`, `AssetRegisterPage.tsx`, `api.ts`, `schema.ts`, `types.ts`

### Issues

#### Critical
_None found._

#### Warning

1. **`Number(a.vendorAmountPaid)` on Decimal field** (`AssetsListPage.tsx`, diff line 571)  
   ```ts
   vendorAmountPaid: a.vendorAmountPaid !== null && a.vendorAmountPaid !== undefined
       ? Number(a.vendorAmountPaid)
   ```
   `vendorAmountPaid` is `Decimal?` on the DB. The backend correctly uses `new Decimal(dto.vendorAmountPaid)` on write. On the frontend, the API returns it as a string from Prisma JSON serialization, which `Number()` handles fine for this field's max value (≤99,999,999.99 — well within IEEE-754 double precision). However this pattern is inconsistent with the project convention of avoiding `Number()` on money fields. **Recommend**: use `parseFloat(a.vendorAmountPaid)` with the existing `formatNumberDecimal` helper, or leave as string and coerce only at `react-hook-form` level via `valueAsNumber`.

2. **`suppliers.controller.ts` — SOD expansion** (`diff: POST @Roles`)  
   ```diff
   -  @Roles('OWNER', 'BRANCH_MANAGER')
   +  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
   ```
   `FINANCE_MANAGER` and `ACCOUNTANT` can now create new vendor master records. Since these same roles can also create and post expense documents (which reference vendors), this increases the blast radius for a compromised Finance/Accounting account: a single actor could create a fictitious vendor and then create a payable to it. **Recommend**: confirm this role expansion is intentional with the business owner; if so, add a comment documenting the decision.

#### Info

3. **`as any` cast on `FormProvider`** (`AssetEntrySection3Vendor.tsx`)  
   ```ts
   return <FormProvider {...(methods as any)}>{children}</FormProvider>;
   ```
   TypeScript type mismatch between `useForm` generic shape and `FormProvider` props. Common pattern in `react-hook-form` typed contexts — no runtime risk.

4. **`as unknown as Prisma.InputJsonValue`** (`asset.service.ts`, multiple locations)  
   Necessary cast for JSONB column assignment. Prisma's `InputJsonValue` type requires this pattern when the source is a typed object. Low risk; typed input is validated upstream by `PermissionConfigEntryDto`.

### Security Checks
- ✅ Class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on `AssetController`
- ✅ `SuppliersController` class-level guards unchanged
- ✅ `PermissionConfigEntryDto` has full class-validator coverage with Thai messages
- ✅ `invalidateQueries({ queryKey: ['suppliers-list'] })` called on mutation `onSuccess`
- ✅ No raw `fetch()` in frontend
- ✅ No hardcoded secrets or API keys
- ✅ `vendorAmountPaid` stored as `new Decimal()` on backend (DB is Decimal-safe)
- ✅ 3 Prisma migrations present and correctly structured

### Recommendation: **REVIEW** ⚠️
Resolve Warning #2 (SOD confirmation) before merge. Warning #1 is low-risk but should be noted.

---

## feat/asset-ui-polish-pr2b

### Summary
UI polish pass: group-card summary report with grand totals, CoA-joined account names in JE preview (replaces hardcoded strings), anti-regression test to prevent future hardcoding, and status badge color overrides per design PDF.

### File Changes
- `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` — group cards + grand total
- `apps/web/src/pages/assets/hooks/useAssetCalculation.ts` — CoA name resolution
- `apps/web/src/pages/assets/hooks/useDisposalCalculation.ts` — CoA name resolution
- `apps/web/src/pages/assets/hooks/__tests__/no-hardcoded-account-name.test.ts` — anti-regression test (63 LOC)
- `apps/web/src/pages/assets/components/AssetStatusBadge.tsx` — status color overrides
- Other: `AssetEntryPage.tsx`, `AssetRegisterPage.tsx`, `AssetsListPage.tsx`, `DepreciationPage.tsx`

### Issues

#### Critical
_None found._

#### Warning

1. **`parseFloat()` on financial aggregate fields** (`AssetSummaryReportPage.tsx`)  
   ```ts
   totalPurchaseCost: acc.totalPurchaseCost + parseFloat(r.totalPurchaseCost || '0'),
   totalAccumulatedDepr: acc.totalAccumulatedDepr + parseFloat(r.totalAccumulatedDepr || '0'),
   totalNbv: acc.totalNbv + parseFloat(r.totalNbv || '0'),
   ```
   These fields (`totalPurchaseCost`, `totalAccumulatedDepr`, `totalNbv`) are Decimal aggregates from the API. Accumulating them via `parseFloat()` + JavaScript `+` operator introduces float drift. For a grand-total display card with many assets, rounding errors could accumulate visibly. **Recommend**: use `Number(r.totalPurchaseCost ?? 0)` with immediate `formatNumberDecimal` at render time instead of pre-accumulating, or use `decimal.js` for the accumulator (already imported in `useDisposalCalculation`).

#### Info

2. **Hardcoded Tailwind semantic colors in `AssetStatusBadge.tsx`**  
   ```ts
   POSTED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
   REVERSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
   DISPOSED: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
   WRITTEN_OFF: 'bg-red-500/15 text-red-700 dark:text-red-400',
   ```
   Rules prohibit `text-gray-*` and hardcoded hex — status-specific semantic colors (`emerald`, `amber`, etc.) are not explicitly banned. However, the spirit of the design token system is to centralize colors. Acceptable per current rules if these colors match the design PDF spec (comment claims they do). Note for future: consider CSS variables for status colors.

3. **`text-emerald-600 dark:text-emerald-400` in `AssetSummaryReportPage.tsx`**  
   Same class as above — NBV column accent. Consistent with emerald as the primary accent. Info-level only.

4. **Hardcoded CoA codes `'53-1605'`, `'42-1105'` in `useDisposalCalculation.ts`**  
   Used only to pre-fetch CoA names (not as display strings). The anti-regression test in this PR explicitly guards against hardcoded *names*. Codes as identifiers are stable and acceptable.

### Security Checks
- ✅ No new controllers or API endpoints
- ✅ No raw `fetch()` in frontend
- ✅ No hardcoded secrets or API keys
- ✅ No `@IsOptional` bypasses or missing validation
- ✅ `useCoaByCodes` uses `api.get()` from `@/lib/api` (React Query)

### Recommendation: **REVIEW** ⚠️
Resolve Warning #1 (float accumulation on financial fields) before merge. Info items are non-blocking.

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/asset-sidebar-merge` | 0 | 0 | 3 | ✅ APPROVE |
| `feat/asset-ui-polish-pr2a` | 0 | 2 | 2 | ⚠️ REVIEW |
| `feat/asset-ui-polish-pr2b` | 0 | 1 | 3 | ⚠️ REVIEW |

**No branch has Critical blockers.** The two REVIEW branches have Warning-level issues that should be confirmed/fixed before merge but are not security vulnerabilities.
