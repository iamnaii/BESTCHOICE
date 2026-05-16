# Merge Guard Report — feat/asset-ui-polish-pr2b

**Date**: 2026-05-16  
**Branch**: `feat/asset-ui-polish-pr2b`  
**Author**: Akenarin Kongdach  
**Commits**: 9  
**Diff summary**: 12 files changed, 1019 insertions(+), 94 deletions(-)

---

## Summary

Frontend-only UI polish pass for the asset module (P9–P17 from the PR 2b design spec). Key changes: sticky footer with validation status + Dr/Cr balance indicator on AssetEntryPage, category group cards with grand total on AssetSummaryReportPage, filter alignment fixes on AssetRegisterPage, status badge color overrides, and breadcrumb on AssetsListPage. Also adds a P13 anti-regression test that prevents hardcoded `accountName` strings in calculation hooks.

---

## File Changes

| Area | Files | Notes |
|------|-------|-------|
| AssetEntryPage | `AssetEntryPage.tsx` | Sticky footer redesign (validation status + Dr=Cr indicator) |
| AssetRegisterPage | `AssetRegisterPage.tsx` | Filter label alignment, table header contrast, Print PDF button |
| AssetSummaryReportPage | `AssetSummaryReportPage.tsx` | CategoryGroupCards with grand total (replaces SummaryTable) |
| AssetsListPage | `AssetsListPage.tsx` | Breadcrumb wired via PageHeader prop |
| AssetEntrySection2Cost | `components/AssetEntrySection2Cost.tsx` | VAT/WHT section accent borders |
| AssetStatusBadge | `components/AssetStatusBadge.tsx` | Per-status color override classes |
| useAssetCalculation | `hooks/useAssetCalculation.ts` | Adds `totalDr`, `totalCr`, CoA name lookup via `useCoaByCodes` |
| useDisposalCalculation | `hooks/useDisposalCalculation.ts` | Same CoA name lookup pattern |
| Anti-regression test | `hooks/__tests__/no-hardcoded-account-name.test.ts` | Vitest `?raw` import to scan source for hardcoded `accountName` literals |
| Plan docs | `docs/superpowers/plans/...` | Spec + design docs (2 new markdown files) |

---

## Issues Found

### Critical (must fix before merge)

None.

### Warning (should fix)

**W1 — Hardcoded non-semantic color classes in 3 locations**

Frontend rule (`.claude/rules/frontend.md`): *"ห้ามใช้ hardcoded hex colors — ใช้ CSS variable tokens เท่านั้น"*, *"ห้ามใช้ text-gray-* ... ใช้ semantic tokens"*.

While the rule explicitly forbids hardcoded hex values and gray classes, the spirit of "use design tokens only" extends to feature-specific palette classes that bypass the theme system. The following classes introduce palette coupling that breaks dark-mode consistency and will drift if the theme changes:

1. **AssetEntrySection2Cost.tsx** — VAT section border:
   ```tsx
   className="border-l-4 border-violet-500 bg-violet-50/30 dark:bg-violet-950/30 rounded-r-lg"
   ```
   WHT section border:
   ```tsx
   className="border-l-4 border-amber-500 bg-amber-50/30 dark:bg-amber-950/30 rounded-r-lg"
   ```
   
2. **AssetStatusBadge.tsx** — per-status override map:
   ```ts
   REVERSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
   DISPOSED: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
   WRITTEN_OFF: 'bg-red-500/15 text-red-700 dark:text-red-400',
   ```

**Mitigation path**: For the section accents, use CSS variables (`--color-vat: ...`, `--color-wht: ...`) defined in `index.css`, or map to `border-primary` + `border-secondary` if design intent allows. For status badges, use the shared `assetStatusMap` variant/appearance system already in `status-badges.ts`.

**Note**: `text-emerald-600 dark:text-emerald-400` used in AssetEntryPage and AssetSummaryReportPage is borderline acceptable — the design spec explicitly calls for Emerald as the primary accent — but ideally replaced with `text-primary` where it represents "success/balanced" state.

### Info

**I1 — `parseFloat()` on Decimal string fields for display**  
File: `AssetSummaryReportPage.tsx` (CategoryGroupCards component)  
```tsx
totalPurchaseCost: acc.totalPurchaseCost + parseFloat(r.totalPurchaseCost || '0'),
```
These are display-only totals computed in the frontend for the grand total card. No financial recording occurs — this is purely for formatting. Low risk in this context, but if the server-side sum is available it would be cleaner to aggregate on the server. Acceptable for UI aggregation.

**I2 — `window.print()` for PDF export**  
File: `AssetRegisterPage.tsx:184`  
Browser's native print is the simplest approach for a register list. No security concern. May render inconsistently across browsers; consider a `/assets/register/pdf` endpoint long-term.

**I3 — Large new doc files**  
`docs/superpowers/plans/2026-05-15-asset-ui-polish-pr2b.md` (392 lines) and `*-design.md` (208 lines). These are planning artifacts, not code — no impact on runtime.

---

## Recommendation

**REVIEW** ⚠️

No critical security or correctness issues. The W1 color-token violations should be addressed before merge to keep the codebase consistent with the design-token convention. The fix is mechanical (replace palette classes with CSS variable tokens or semantic Tailwind tokens). All other patterns are correct: `useQuery` used for data fetching, `queryClient.invalidateQueries` present after mutations, no raw `fetch()`, proper `api.get()` usage.
