# Merge Guard Report — feat/asset-ui-polish-pr2b

**Date**: 2026-05-16  
**Branch**: `feat/asset-ui-polish-pr2b`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: `test(assets): anti-regression for P13 SSOT — forbid hardcoded accountName in hooks` (2026-05-15 15:11 +0700)  
**Commits ahead of main**: 9  
**Diff size**: 12 files changed, +1,019 / -94 lines  

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/assets/AssetEntryPage.tsx` | Modified — cost section UX polish |
| `apps/web/src/pages/assets/AssetRegisterPage.tsx` | Modified — register list polish |
| `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` | Modified — summary report additions |
| `apps/web/src/pages/assets/AssetsListPage.tsx` | Modified — list view polish |
| `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` | Minor change |
| `apps/web/src/pages/assets/components/AssetStatusBadge.tsx` | Minor change |
| `apps/web/src/pages/assets/hooks/useAssetCalculation.ts` | Modified — CoA SSOT integration |
| `apps/web/src/pages/assets/hooks/useDisposalCalculation.ts` | Modified (+60) — CoA name resolution via `useCoaByCodes` |
| `apps/web/src/pages/assets/hooks/__tests__/no-hardcoded-account-name.test.ts` | New — P13 anti-regression test |
| `apps/web/src/pages/depreciation/DepreciationPage.tsx` | Minor — adds RotateCcw button |
| `docs/plans/2026-05-15-asset-ui-polish-pr2b.md` | New doc (plan) |
| `docs/plans/2026-05-15-asset-ui-polish-pr2b-design.md` | New doc (design) |

---

## Issues by Severity

### Critical (0 issues)

None found.

- No new backend controllers — no guard check required.
- No `Number()` on financial fields.
- No raw SQL (`$queryRaw` with string interpolation).
- No hardcoded secrets or API keys.

### Warning (1 issue)

**W1 — `useDisposalCalculation.ts`: CoA name fallback to bare code while loading**

In the new `accountName()` helper:
```ts
const accountName = (code: string) => nameByCode.get(code) ?? code;
```
While `useCoaByCodes` resolves, the account name falls back to the raw code string (e.g. `"53-1605"`) which can appear in the JE preview before the React Query resolves. This is acceptable per the inline comment but could produce a momentary flash of raw codes in the PDF preview. Consider showing a skeleton/loading state in the disposal JE preview component while `coaRows` is undefined.

### Info (2 items)

**I1 — New anti-regression test for P13 SSOT**  
`no-hardcoded-account-name.test.ts` enforces that no `accountName` literals are hardcoded in calculation hooks. Good defensive testing pattern.

**I2 — `AssetSummaryReportPage.tsx` +120 lines**  
File is growing (added 120 lines). Not a blocker but worth watching — consider splitting sub-components if it exceeds ~400 total lines.

---

## Recommendation

**✅ APPROVE**

No critical or blocking issues. The branch correctly implements the CoA SSOT pattern (P13) — account names are resolved via the `useCoaByCodes` hook rather than hardcoded strings, and an anti-regression test enforces this going forward. The disposal calculation hook properly uses `Prisma.Decimal` math (frontend display hook, not a backend service). The depreciation page UI changes are minor and safe.

Address W1 before or after merge at the team's discretion — it is UX-only and does not affect data integrity.
