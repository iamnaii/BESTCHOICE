# Merge Guard Report — feat/asset-ui-polish-pr2b

**Date**: 2026-05-15  
**Branch**: `feat/asset-ui-polish-pr2b`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

| Category | Count |
|---|---|
| Files changed | 12 |
| Insertions | +1,019 |
| Deletions | -94 |

**Key files touched:**
- `apps/web/src/pages/assets/AssetRegisterPage.tsx` — 117 lines changed
- `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` — 120 lines added
- `apps/web/src/pages/assets/AssetEntryPage.tsx` — sticky action bar redesign
- `apps/web/src/pages/assets/hooks/useDisposalCalculation.ts` — CoA join for account names
- `apps/web/src/pages/assets/hooks/useAssetCalculation.ts` — 50 lines
- `apps/web/src/pages/assets/AssetsListPage.tsx` — 25 lines
- `apps/web/src/pages/assets/components/AssetStatusBadge.tsx` — per-status color override
- `apps/web/src/pages/depreciation/DepreciationPage.tsx` — 9 lines
- `apps/web/src/pages/assets/hooks/__tests__/no-hardcoded-account-name.test.ts` — anti-regression test (new)
- `docs/plans/` — 2 design/plan documents

---

## Issues by Severity

### Critical — None Found

All critical checks passed:

- **Guards**: Frontend-only branch. No new controllers, no backend changes. N/A.
- **`Number()` on money**: `useDisposalCalculation.ts` and `useAssetCalculation.ts` use `decimal.js` (`Decimal`) throughout. No `Number()` or `parseFloat()` on financial values in new code.
- **`deletedAt: null`**: Frontend-only branch. No direct Prisma queries. API calls go through `api.get()` — server enforces soft-delete filters. N/A.
- **Hardcoded secrets**: None found.
- **SQL injection**: No backend changes. N/A.

---

### Warning — 1 Found

**W-ASSET-01: Hardcoded Tailwind semantic color classes outside design token system**

Multiple locations in this branch use hardcoded Tailwind Emerald and semantic color classes instead of CSS variable tokens:

`AssetEntryPage.tsx`:
```tsx
className="... text-emerald-600 dark:text-emerald-400"
// Also in the isBalanced conditional:
'text-emerald-600 dark:text-emerald-400'
```

`AssetStatusBadge.tsx`:
```ts
const STATUS_CLASS_OVERRIDE = {
  POSTED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REVERSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  DISPOSED: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  WRITTEN_OFF: 'bg-red-500/15 text-red-700 dark:text-red-400',
};
```

The frontend rules state: "ห้ามใช้ hardcoded hex colors" and semantic tokens should be preferred (`bg-primary`, `text-primary`, etc.). The `AssetStatusBadge` case is more nuanced — status badges typically need distinct colors to communicate state, and the shadcn/ui `Badge` component's `variant` prop provides limited color variety. The `text-emerald-*` in `AssetEntryPage` should use `text-primary` (emerald is the theme's primary).

**Action**: Replace `text-emerald-600 dark:text-emerald-400` in `AssetEntryPage` with `text-primary` for token consistency. `AssetStatusBadge` status overrides are a justified exception (design system limitation for multi-state badges) — document with a comment. Not a blocker but should be addressed before PR close.

---

### Info — 3 Items

**I-ASSET-01: Anti-regression test for hardcoded account names — excellent pattern**

`apps/web/src/pages/assets/hooks/__tests__/no-hardcoded-account-name.test.ts` (new, 63 lines) — AST-based test that parses the disposal and asset calculation hook source files and asserts no string literals beginning with `"Dr "` or `"Cr "` exist. This prevents the P13 regression where account names were hardcoded. Clean, maintainable approach.

**I-ASSET-02: `useCoaByCodes` hook called inside `useDisposalCalculation`**

`useDisposalCalculation.ts` now calls `useCoaByCodes(candidateCodes)` — this is a React Query hook, requiring the disposal calculation to run inside a React component/hook context. The existing usage pattern (this hook is consumed in `AssetDisposalPage`) already satisfies this requirement. No issues.

**I-ASSET-03: `eslint-disable react-hooks/exhaustive-deps` comment**

`useDisposalCalculation.ts` line ~139:
```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [asset, values, nameByCode]);
```
The disable is justified — `accountName` is a closure that depends on `nameByCode` (already in deps), and including it would cause a stale-closure false positive. The comment explains the reason. Acceptable.

---

## Security Checks

| Check | Result |
|---|---|
| `JwtAuthGuard` / `@Roles()` | ✅ N/A (frontend-only branch) |
| No `Number()` on stored money fields | ✅ Pass |
| `deletedAt: null` in queries | ✅ N/A (no new direct Prisma queries) |
| No hardcoded secrets/API keys | ✅ Pass |
| Frontend uses `api.get()`/`api.post()` (no raw fetch) | ✅ Pass |
| `queryClient.invalidateQueries()` after mutations | ✅ Pass (no new mutations introduced) |
| No hardcoded hex colors | ⚠️ Warning — see W-ASSET-01 (Tailwind utility classes, not hex) |
| Thai text uses `leading-snug` | ✅ Pass (no Thai text block changes observed) |

---

## Recommendation: **REVIEW**

This branch is safe to merge functionally — no security issues, no money calculation bugs, and an excellent anti-regression test pattern. The one warning (hardcoded Tailwind color utilities in `AssetEntryPage` and `AssetStatusBadge`) is a rules violation per frontend.md. `AssetStatusBadge` has a justifiable exception case (multi-state badge colors), but `AssetEntryPage`'s `text-emerald-600` should be replaced with `text-primary` before merge. Recommend author makes that change and re-requests review, or the reviewer accepts it as a documented exception.
