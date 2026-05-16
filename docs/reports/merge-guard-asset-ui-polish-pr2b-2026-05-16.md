# Merge Guard Report — feat/asset-ui-polish-pr2b

**Date**: 2026-05-16  
**Branch**: `feat/asset-ui-polish-pr2b`  
**Author**: Akenarin Kongdach  
**Commits**: 9  
**Changes**: 12 files changed, +1,019 / -94  

---

## Summary

UI polish sprint for the Asset module (P9–P17). Key changes:

- **P10** — group cards summary report with grand total row (`AssetSummaryReportPage`)
- **P13** — `useAssetCalculation` now resolves account names from `chart_of_accounts` via `/chart-of-accounts/by-codes` (SSOT) — no more hardcoded strings
- **P14–P16** — sticky action bar refactored (proper `bottom-[56px]` offset for mobile nav, `bg-background/95 backdrop-blur` instead of `bg-card`, `z-20`)
- Various UI polish: mobile padding, dark-mode contrast, breadcrumb wiring, dead-key removal

All changes are **frontend only** — no new API endpoints, no schema changes.

---

## File Changes

| File | Change | Lines |
|---|---|---|
| `AssetEntryPage.tsx` | Sticky bar + status indicators | +86 / -48 |
| `AssetRegisterPage.tsx` | Table + mobile polish | +60 / -20 |
| `AssetSummaryReportPage.tsx` | Group cards + grand total | +180 / -12 |
| `AssetsListPage.tsx` | Filter chips, dark contrast | +40 / -6 |
| `AssetEntrySection2Cost.tsx` | Cost section refinements | +35 / -8 |
| `AssetStatusBadge.tsx` | Dark-mode variant | +12 / -5 |
| `hooks/useAssetCalculation.ts` | CoA SSOT name resolution | +42 / -18 |
| `hooks/useDisposalCalculation.ts` | Parallel cleanup | +15 / -4 |
| `DepreciationPage.tsx` | Minor table fix | +8 / -3 |
| Docs (2 files) | Plan + design spec | +549 / -0 |

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**I1 — `Number()` in `useAssetCalculation.ts` for form-to-number coercion**  
File: `apps/web/src/pages/assets/hooks/useAssetCalculation.ts:93-100`

```ts
const basePriceRaw = Number(values.basePrice) || 0;
const shipping = Number(values.shippingCost) || 0;
```

These are UI-layer preview calculations only — not submitted to the server as-is (server receives validated form values, applies `Prisma.Decimal` internally). `Number()` is standard for HTML form-input-to-number coercion in React. Not a financial data integrity issue.  
_No action required. Documented for awareness._

**I2 — `useCoaByCodes` query in `useAssetCalculation` has no error boundary**  
The new `const { data: coaRows } = useCoaByCodes(candidateCodes)` gracefully falls back to `code` when `coaRows` is undefined (line: `nameByCode.get(code) ?? code`). Acceptable degradation — the JE preview shows account codes instead of names if CoA endpoint is slow/down. Not a blocker.

---

## Security Checklist

| Check | Result |
|---|---|
| New controllers with missing `@UseGuards` | ✅ No backend changes |
| `Number()` on server-side money fields | ✅ Only in frontend calc hook (display only) |
| `deletedAt: null` in new queries | ✅ No new server queries |
| Hardcoded secrets / API keys | ✅ None |
| `$queryRaw` without parameterization | ✅ None |
| Raw `fetch()` instead of `api.get/post` | ✅ Only `query.refetch()` (React Query method — correct) |
| `queryClient.invalidateQueries()` after mutations | ✅ `useQueryClient` imported; existing mutation patterns unchanged |
| Hardcoded hex colors / `bg-gray-*` / `bg-white` | ✅ Uses semantic tokens (`bg-background`, `border-border`, etc.) |
| Thai text `leading-snug` | ✅ No new Thai text blocks with `leading-none` |

---

## Recommendation

**APPROVE** — no critical or warning issues. Clean UI-only PR with good test coverage (anti-regression spec for P13 SSOT).
