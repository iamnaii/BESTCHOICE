# Merge Guard Report — feat/asset-ui-polish-pr2b

**Date**: 2026-05-16  
**Branch**: `feat/asset-ui-polish-pr2b`  
**Author**: Akenarin Kongdach  
**Last commit**: `test(assets): anti-regression for P13 SSOT` (2026-05-15 15:11 BKK)  
**Commits ahead of main**: 9  
**Recommendation**: ⚠️ REVIEW (1 warning before merge; 1 warning deferred)

> **Note**: A prior guard pass on this branch (same date) issued APPROVE. This pass found an additional `parseFloat`-on-money issue in `AssetSummaryReportPage.tsx` that was missed; recommendation updated to REVIEW.

---

## File Changes Summary (12 files, +1019/−94)

| File | Change |
|------|--------|
| `AssetEntryPage.tsx` | Sticky action bar redesign — validation status + Σ Dr/Cr display |
| `AssetRegisterPage.tsx` | Print button, filter labels, table header contrast |
| `AssetSummaryReportPage.tsx` | New `CategoryGroupCards` component, category icons |
| `AssetsListPage.tsx` | Breadcrumb addition |
| `AssetEntrySection2Cost.tsx` | Colour-coded VAT/WHT section borders |
| `AssetStatusBadge.tsx` | Per-status Tailwind colour overrides |
| `hooks/useAssetCalculation.ts` | CoA name resolution from API (P13 SSOT fix) |
| `hooks/useDisposalCalculation.ts` | CoA name resolution from API (P13 SSOT fix) |
| `DepreciationPage.tsx` | Minor icon + button label changes |
| `hooks/__tests__/no-hardcoded-account-name.test.ts` | New anti-regression test (P13) |
| `docs/plans/2026-05-15-asset-ui-polish-pr2b.md` | New plan doc |
| `docs/plans/2026-05-15-asset-ui-polish-pr2b-design.md` | New design doc |

---

## Issues Found

### Critical (0 issues)

No new backend controllers — no guard check required.  
No `Number()` on financial backend fields.  
No raw SQL with string interpolation.  
No hardcoded secrets or API keys.  

---

### ⚠️ Warning — W1: `parseFloat()` on money fields in `AssetSummaryReportPage.tsx` (fix before merge)

**File**: `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` (`CategoryGroupCards` component)

```tsx
// grandTotal accumulation
totalPurchaseCost: acc.totalPurchaseCost + parseFloat(r.totalPurchaseCost || '0'),
totalAccumulatedDepr: acc.totalAccumulatedDepr + parseFloat(r.totalAccumulatedDepr || '0'),
totalNbv: acc.totalNbv + parseFloat(r.totalNbv || '0'),
```

`SummaryRow` fields are `string` (Decimal serialised by the API). Using `parseFloat` for accumulation introduces IEEE-754 floating-point drift. For large asset portfolios this can produce visible display discrepancies.

`decimal.js` is already imported in `useDisposalCalculation.ts` in this same PR. Project rule: "use Decimal, never Float for money."

**Fix** (simplest):
```ts
import Decimal from 'decimal.js';
// in grandTotal accumulation:
totalPurchaseCost: new Decimal(acc.totalPurchaseCost).plus(r.totalPurchaseCost || '0').toNumber(),
// repeated for totalAccumulatedDepr, totalNbv
```

---

### ⚠️ Warning — W2: Non-semantic Tailwind colour tokens (defer to next design-token sprint)

**Files**:
- `AssetEntrySection2Cost.tsx` — `border-violet-500`, `bg-violet-50/30`, `border-amber-500`, `bg-amber-50/30`
- `AssetStatusBadge.tsx` — `bg-emerald-500/15`, `bg-purple-500/15`, `bg-red-500/15`
- `AssetEntryPage.tsx`, `AssetSummaryReportPage.tsx` — `text-emerald-600 dark:text-emerald-400`

These use direct Tailwind palette names rather than design-token CSS variables (`bg-primary`, `text-muted-foreground`, etc.), violating `rules/frontend.md`. `emerald` for positive financial values is consistent with the established brand pattern. `violet`/`amber` section accents are new additions not in the token system.

**Recommended fix**: Map VAT section to `border-primary/40 bg-primary/5`, WHT to `border-warning bg-warning/5` (or add a `--color-warning` token). Not a merge blocker — can be resolved in the next design-token housekeeping sprint.

---

### ℹ️ Info

**I1**: `eslint-disable-next-line react-hooks/exhaustive-deps` in `useAssetCalculation.ts` and `useDisposalCalculation.ts`. Both have explanatory comments; suppression is intentional. Monitor during future hook refactors.

**I2**: CoA name fallback shows raw code (e.g. `"11-4101"`) while `useCoaByCodes` is resolving. Cosmetic — backfills once React Query resolves. Consider a skeleton state in the JE preview if the flash is noticeable in UX testing.

---

## Positive Findings

- ✅ P13 SSOT fix: `useAssetCalculation` + `useDisposalCalculation` resolve account names from CoA endpoint, no more hardcoded Thai strings
- ✅ `no-hardcoded-account-name.test.ts` — excellent anti-regression pattern using `?raw` import
- ✅ All API calls use `useQuery` / `api.get()` — no raw `fetch()`
- ✅ `DepreciationPage` button: `type="button"` added — prevents form submission bug
- ✅ Breadcrumb in `AssetsListPage` consistent with v4 pattern
- ✅ No new backend controllers or public endpoints

---

## Recommendation: REVIEW

Fix W1 (`parseFloat` on money in `AssetSummaryReportPage`) before merge. W2 (colour tokens) can be deferred. All other findings are informational.
