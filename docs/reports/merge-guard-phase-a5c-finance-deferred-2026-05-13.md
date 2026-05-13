# Merge Guard Report — `phase-a5c-finance-deferred`

**Date:** 2026-05-13  
**Author:** Akenarin Kongdach  
**Last commit:** 2026-05-04  
**Recommendation:** 🚫 BLOCK — fix dual-cron double-depreciation before merge

---

## File Changes Summary

| File | +Lines | −Lines | Notes |
|------|--------|--------|-------|
| `apps/api/prisma/schema.prisma` | +69 | −3 | New `AssetCategory` enum, `FixedAsset` fields, `DepreciationEntry` model, `Expense.taxDisallowed` + `disallowedReason` |
| `apps/api/prisma/migrations/20260802000000_phase_a5c_asset_register/migration.sql` | +40 | 0 | Asset register migration |
| `apps/api/prisma/migrations/20260802100000_phase_a5c_tax_disallowed_flag/migration.sql` | +5 | 0 | Tax-disallowed flag migration |
| `apps/api/src/modules/asset/asset.service.ts` | +36 | −12 | Adds AssetDisposalTemplate injection, new fields in `create()`, replaces dispose() |
| `apps/api/src/modules/asset/asset.module.ts` | +2 | 0 | Imports JournalModule |
| `apps/api/src/modules/asset/dto/asset.dto.ts` | +56 | 0 | New `AssetCategoryDto`, `usefulLifeMonths`, `disposalProceeds` fields |
| `apps/api/src/modules/accounting/dto/expense.dto.ts` | +19 | 0 | `taxDisallowed` + `disallowedReason` fields |
| `apps/api/src/modules/journal/cpa-templates/depreciation.template.ts` | +182 | 0 | New template — category-routed straight-line depreciation |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts` | +192 | 0 | New template — disposal gain/loss JE |
| `apps/api/src/modules/journal/cpa-templates/wht-accrual.template.ts` | +120 | 0 | New template — WHT accrual on expense |
| `apps/api/src/modules/journal/cpa-templates/wht-remittance.template.ts` | +84 | 0 | New template — WHT remittance to Revenue Dept |
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | +82 | 0 | Extended from A.5a — tax-disallowed routing to 54-XXXX |
| `apps/api/src/modules/journal/cron/depreciation.cron.ts` | +76 | 0 | New cron — last-day-of-month depreciation batch |
| `apps/api/src/modules/journal/journal.module.ts` | +14 | 0 | Registers new templates + DepreciationCron |
| Test specs (5 files) | +848 | 0 | Full spec coverage |

**Total:** +1773 / −39 lines, 19 files

---

## Issues Found

### Critical

**C-01 — Dual depreciation crons will double-post JEs** 

Phase-a5c adds `DepreciationCron` (`'0 1 28-31 * *'` — last day of month) but does **not** remove or disable the pre-existing `handleMonthlyDepreciation()` cron in `asset.service.ts` (`'30 0 1 * *'` — 1st of every month).

**Timeline causing double-posting:**
1. Jan 31 at 01:00 → `DepreciationCron` runs → calls `DepreciationTemplate` → creates `DepreciationEntry(assetId, period="2026-01")` + JE
2. Feb 1 at 00:30 → `handleMonthlyDepreciation()` runs → calls `runMonthEndDepreciation()` → no `DepreciationEntry` check → creates **another JE for the same assets** → updates `accumulatedDepre` a second time

The new `DepreciationTemplate` uses `DepreciationEntry` for idempotency. The old `runMonthEndDepreciation()` does **not** consult `DepreciationEntry` and has no period-level guard. Both crons will post depreciation for overlapping months, resulting in:
- Two JEs per asset per month (Dr 53-160X / Cr 12-210X doubled)
- `FixedAsset.accumulatedDepre` incremented twice in the same accounting period
- Trial balance overstates depreciation expense, understates net book value

**Affected files:**
- `apps/api/src/modules/asset/asset.service.ts:381-415` — old cron (pre-existing, must be disabled on merge)
- `apps/api/src/modules/journal/cron/depreciation.cron.ts` — new cron (introduced by this branch)

**Required fix:** Disable `handleMonthlyDepreciation()` in `asset.service.ts` before or within this PR. Options:
  - Remove the `@Cron` decorator and mark the method `@Deprecated` (preferred)
  - Or add a feature-flag guard, though that adds complexity

### Warning

**W-01 — Pre-existing `Number()` on Decimal money fields in `asset.service.ts`**  
_(Pre-existing in main at branch point — not introduced by this PR, but worsened by C-01)_

`calculateMonthlyDepreciation()`, `runMonthEndDepreciation()`, and `getDepreciationSummary()` convert Decimal money fields with `Number()`:

```typescript
// asset.service.ts:195–198 (pre-existing)
const cost = Number(asset.costValue);       // Float precision risk on large amounts
const salvage = Number(asset.salvageValue);
const remaining = maxDepre - Number(asset.accumulatedDepre);
// ...
const newAccumulated = Number(asset.accumulatedDepre) + monthlyDepre; // written back to Decimal column
```

This is independently a convention violation (`rules/database.md` — use `Prisma.Decimal`, never `Float/Number` for money). While not introduced by this PR, the fix to C-01 (disabling the old method) also eliminates this issue. Should be tracked as a separate cleanup ticket if the old method is kept anywhere.

**W-02 — `DepreciationEntry` model is append-only but schema omits doc comment**  
The `DepreciationEntry` model is immutable (correct, no `updatedAt`/`deletedAt`) but the schema comment (`/// Immutable audit log — updatedAt/deletedAt intentionally omitted`) is present. ✅ No action needed — just confirming compliance with `rules/database.md` exception pattern.

### Info

**I-01** — `DepreciationTemplate` correctly uses `Prisma.Decimal` for all arithmetic (depreciableBase, monthlyAmount, actualAmount). No `Number()` conversions.

**I-02** — `AssetDisposalTemplate` correctly uses `new Decimal(dto.disposalProceeds?.toString() ?? '0')` for proceeds. Gain/loss calculation uses Decimal arithmetic throughout.

**I-03** — `WhtAccrualTemplate` and `WhtRemittanceTemplate` use Decimal throughout. WHT base is pre-VAT amount (`amountBeforeVat`), consistent with V17 convention in `rules/accounting.md`.

**I-04** — `DepreciationEntry.@@unique([assetId, period])` ensures DB-level idempotency in addition to the application-level check.

**I-05** — `AssetCategory` typed enum (vs free-text `category: String?`) is a correct addition. Legacy `category` field is preserved for backward compatibility.

**I-06** — `taxDisallowed` + `disallowedReason` on `Expense` model — schema uses `@default(false)` and optional reason. Migration is backward compatible (no existing rows affected). DTO validation uses `@IsIn(['NO_RECEIPT', 'PERSONAL_USE', 'PENALTY', 'OTHER'])`.

---

## Account Code Verification

| Template | Dr | Cr | CPA Chart ✓ |
|----------|----|----|-------------|
| DepreciationTemplate (OFFICE_EQUIPMENT) | 53-1601 | 12-2102 | ✅ |
| DepreciationTemplate (BUILDING_IMPROVEMENT) | 53-1602 | 12-2104 | ✅ |
| DepreciationTemplate (VEHICLE) | 53-1604 | 12-2108 | ✅ |
| AssetDisposalTemplate (gain) | 11-12XX cash + 12-2102 accum | 12-2101 cost + 41-1105 gain | ✅ |
| AssetDisposalTemplate (loss) | 11-12XX cash + 12-2102 accum + 51-1102 loss | 12-2101 cost | ✅ |
| WhtAccrualTemplate | expense + 21-3102/3103 WHT | 21-1104 AP | ✅ |
| WhtRemittanceTemplate | 21-3102/3103 WHT | 11-1201 bank | ✅ |

---

## Required Fix Before Merge

1. **In `apps/api/src/modules/asset/asset.service.ts`:** Remove the `@Cron` decorator from `handleMonthlyDepreciation()` (lines 381–415). The old `runMonthEndDepreciation()` is superseded by `DepreciationTemplate` + `DepreciationCron`. Mark as deprecated or remove entirely.
