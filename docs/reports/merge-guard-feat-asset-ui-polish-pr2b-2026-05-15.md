# Merge Guard Report — feat/asset-ui-polish-pr2b

**Date**: 2026-05-15  
**Branch**: `feat/asset-ui-polish-pr2b`  
**Authors**: Akenarin Kongdach, iamnaii  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/pages/assets/AssetEntryPage.tsx` | +43 / -0 |
| `apps/web/src/pages/assets/AssetRegisterPage.tsx` | +117 / -0 |
| `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` | +120 / -0 |
| `apps/web/src/pages/assets/AssetsListPage.tsx` | +25 / -0 |
| `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` | +4 / -1 |
| `apps/web/src/pages/assets/components/AssetStatusBadge.tsx` | +22 / -0 |
| `apps/web/src/pages/assets/hooks/__tests__/no-hardcoded-account-name.test.ts` | +63 (new) |
| `apps/web/src/pages/assets/hooks/useAssetCalculation.ts` | +50 / -0 |
| `apps/web/src/pages/assets/hooks/useDisposalCalculation.ts` | +60 / -0 |
| `apps/web/src/pages/depreciation/DepreciationPage.tsx` | +9 / -0 |
| `docs/superpowers/plans/2026-05-15-asset-ui-polish-pr2b.md` | +392 (new) |
| `docs/superpowers/plans/2026-05-15-asset-ui-polish-pr2b-design.md` | +208 (new) |

**Total**: 1,019 insertions, 94 deletions across 12 files (incl. 2 plan docs)

---

## Issues Found

### Critical — None

### Warning

**W1 — `parseFloat()` accumulating Decimal financial values in frontend**  
File: `apps/web/src/pages/assets/AssetSummaryReportPage.tsx`  
```ts
const grandTotal = useMemo(() => {
  return data.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      totalPurchaseCost: acc.totalPurchaseCost + parseFloat(r.totalPurchaseCost || '0'),   // ⚠️
      totalAccumulatedDepr: acc.totalAccumulatedDepr + parseFloat(r.totalAccumulatedDepr || '0'), // ⚠️
      totalNbv: acc.totalNbv + parseFloat(r.totalNbv || '0'),  // ⚠️
    }),
    { count: 0, totalPurchaseCost: 0, totalAccumulatedDepr: 0, totalNbv: 0 },
  );
}, [data]);
```
And in the render:
```tsx
{formatNumberDecimal(parseFloat(row.totalPurchaseCost))}
{formatNumberDecimal(parseFloat(row.totalAccumulatedDepr))}
{formatNumberDecimal(parseFloat(row.totalNbv))}
```
These are display-only values (not persisted), but accumulating Prisma `Decimal` strings via `parseFloat` into a JS `number` accumulator risks floating-point rounding errors for large Thai Baht values (e.g., assets worth tens of millions). The grand total row could show `฿12,500,000.01` instead of `฿12,500,000.00`.

**Recommended fix**: Use a `Decimal`-based accumulator (e.g., `import Decimal from 'decimal.js'`) or accumulate as `string → Decimal → string` round-trip:
```ts
import Decimal from 'decimal.js';
totalPurchaseCost: new Decimal(acc.totalPurchaseCost).plus(r.totalPurchaseCost || 0).toNumber(),
```
Or keep simple `parseFloat` for individual display but compute the grand total server-side.

**W2 — Hardcoded `text-emerald-*` instead of semantic CSS token `text-primary`**  
Files:
- `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` (3 occurrences)
- `apps/web/src/pages/assets/components/AssetStatusBadge.tsx` (1 occurrence)

```tsx
// AssetSummaryReportPage.tsx — found in grand total card and per-category row
className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"

// AssetStatusBadge.tsx
POSTED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
```

Frontend rule: **ห้ามใช้ hardcoded hex colors — ใช้ CSS variable tokens เท่านั้น**. Since the project theme defines primary = emerald, `text-primary` (or `text-primary/80` for the badge) is the correct token. Hardcoding bypasses the CSS variable system and breaks if the primary color ever changes.

**Recommended fix**:
```tsx
// Instead of:
className="text-emerald-600 dark:text-emerald-400"
// Use:
className="text-primary"

// Instead of:
POSTED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
// Use:
POSTED: 'bg-primary/15 text-primary',
```

### Info

**I1 — Anti-regression test `no-hardcoded-account-name.test.ts` added** — Excellent pattern. The `?raw` Vite import for static analysis catches CoA SSOT violations at test time without needing the full runtime.

**I2 — Plan docs added to `docs/superpowers/plans/`** (600 lines combined) — Informational, not a code concern.

---

## Security Check

- No new controllers — existing `AssetController` guards unchanged  
- No new API endpoints in this branch  
- No hardcoded secrets  
- No raw `fetch()` calls  
- No `$queryRaw`  

---

## Verdict

**⚠️ REVIEW** — No critical issues or security concerns. Two warnings should be addressed before merge:

1. **W1**: Replace `parseFloat` accumulator in grand total with Decimal-safe arithmetic (precision risk on large sums)
2. **W2**: Replace `text-emerald-*` / `bg-emerald-*` with `text-primary` / `bg-primary` tokens in `AssetSummaryReportPage.tsx` and `AssetStatusBadge.tsx`

Both are small targeted fixes. Not a hard block, but the color token violation is a project rule and the Decimal precision issue can cause confusing display discrepancies on the report page.
