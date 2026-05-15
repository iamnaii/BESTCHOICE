# Merge Guard Report — feat/asset-ui-polish-pr2a

**Date**: 2026-05-15  
**Branch**: `feat/asset-ui-polish-pr2a`  
**Authors**: Akenarin Kongdach, iamnaii  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/pages/assets/AssetDisposePage.tsx` | +4 / -0 |
| `apps/web/src/pages/assets/AssetEntryPage.tsx` | +14 / -0 |
| `apps/web/src/pages/assets/AssetRegisterPage.tsx` | +4 / -0 |
| `apps/web/src/pages/assets/AssetSchedulePage.tsx` | +4 / -0 |
| `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` | +2 / -1 |
| `apps/web/src/pages/assets/AssetsListPage.tsx` | +80 / -0 |
| `apps/web/src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx` | +93 (new) |
| `apps/web/src/pages/assets/__tests__/AssetEntrySection5Permission.test.tsx` | +81 (new) |
| `apps/web/src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx` | +49 (new) |
| `apps/web/src/pages/assets/api.ts` | +23 |
| `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` | +2 / -1 |
| `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx` | +303 / +0 |
| `apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx` | deleted (-170) |
| `apps/web/src/pages/assets/components/AssetEntrySection5Permission.tsx` | +175 (new) |
| `apps/web/src/pages/assets/schema.ts` | +20 |
| `apps/web/src/pages/assets/types.ts` | +23 |
| `apps/web/src/pages/assets/utils/exportRegister.ts` | +2 / -1 |
| `docs/superpowers/plans/2026-05-15-asset-ui-polish-pr2a.md` | +1004 (new) |
| `docs/superpowers/plans/2026-05-15-asset-ui-polish-pr2a-design.md` | +274 (new) |

**Total**: 2,372 insertions, 281 deletions across 28 files (incl. 2 plan docs)

---

## Issues Found

### Critical — None

### Warning

**W1 — `Number(a.vendorAmountPaid)` on a financial field**  
File: `apps/web/src/pages/assets/AssetEntryPage.tsx`  
```ts
vendorAmountPaid:
  a.vendorAmountPaid !== null && a.vendorAmountPaid !== undefined
    ? Number(a.vendorAmountPaid)
    : undefined,
```
`vendorAmountPaid` maps to a `Decimal` column in the database. `Number()` coercion for form state initialization can lose precision on values with many decimal places. Recommended fix: use `parseFloat(String(a.vendorAmountPaid))` or pass the raw string into the form and let the input handle display, coercing only at submit. Not a DB-write issue (the DTO `@IsNumber()` validator on the API side is the real gate), but the frontend loses Decimal precision at ~15 significant digits.

**W2 — `as any` cast in `FormProvider` wrapper**  
File: `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx` (and one other location)  
```ts
return <FormProvider {...(methods as any)}>{children}</FormProvider>;
```
This is a react-hook-form typing workaround. Acceptable short-term but should be typed properly via `UseFormReturn<VendorFormValues>` generic. Not a runtime risk.

### Info

**I1 — `AssetEntrySection3Vendor.tsx` at 406 lines**  
File: `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx`  
Approaching the 500-line guideline. Contains inline supplier-create dialog + form + table. If this file grows further, consider extracting the inline `SupplierCreateDialog` to its own file.

**I2 — 3 new test files added** — Good practice. Test coverage included for stat cards, vendor section, and permission UI.

---

## Security Check

- No new controllers — existing `AssetController` guards unchanged  
- `PermissionConfigEntryDto` uses `@IsUUID`, `@IsBoolean` with Thai messages — compliant  
- `CreateAssetDto.permissionConfig` uses `@IsArray` + `@ValidateNested({ each: true })` + `@Type(() => PermissionConfigEntryDto)` — properly validated  
- No hardcoded secrets  
- No raw `fetch()` calls — all via `api.*`  
- `invalidateQueries({ queryKey: ['suppliers-list'] })` present in mutation `onSuccess`  

---

## Verdict

**✅ APPROVE** — No critical issues. W1 (Decimal coercion) is worth fixing in a follow-up but does not affect DB writes. Tests included. Guards unchanged.
