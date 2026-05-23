# Merge Guard Report — feat/defect-exchange-wizard-flow

**Date**: 2026-05-23  
**Branch**: `feat/defect-exchange-wizard-flow`  
**Base**: `origin/main`  
**Reviewed by**: Pre-Merge Guard Agent

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/pages/DefectExchangePage.tsx` | +238 / -149 |
| `apps/web/package.json` | version bump 26.5.22 → 26.5.23 |

Total: **3 files changed**, 286 insertions(+), 149 deletions(-)

---

## Commits on Branch (beyond main)

1. `dbae5016` feat(defect-exchange): refactor to 3-step wizard matching insurance wizard pattern  
2. `81393bee` test(seed): add PHONE_USED exchange test set  
3. `5b5dee99` fix(defect-exchange): products limit 300 → 200 (PaginationDto.@Max(200))

---

## Issues

### Critical
_None found._

### Warning
_None found._

### Info

**I1 — Wizard skip-to-step-2 relies on `presetContractId` being stable across renders**  
`const [step, setStep] = useState<1 | 2 | 3>(presetContractId ? 2 : 1)` initialises step once at mount. If the parent component ever changes `presetContractId` after mount, the step state won't update. This is currently safe because `presetContractId` comes from a `props` object that is only set from URL/query params at page load. No action required — worth a comment if the props contract ever changes.

**I2 — `Card className="p-6"` without `CardContent` wrapper**  
Steps 1, 2, and 3 wrap content with `<Card className="p-6 space-y-4">` directly, whereas the project convention uses `<Card><CardContent className="p-5">...</CardContent></Card>`. The `CardContent` import was removed. This is functionally equivalent and consistent with the insurance wizard pattern the PR is modelling — no runtime issue. Minor style drift only.

**I3 — Products query limit reduced 300 → 200**  
Commit `5b5dee99` changes `/products?status=IN_STOCK&category=PHONE_USED&limit=200`. This matches the backend `PaginationDto.@Max(200)` constraint (was silently clamped before). Low risk.

---

## Dependency / Merge Order Note

This branch's base state of `DefectExchangePage.tsx` (`06032eae`) already includes the fix from `hotfix/defect-exchange-preset-contract-visibility` (which adds `presetContractId ?? null` to the query key and allows PHONE_NEW contracts when `presetContractId` is set).

**Recommended merge order**:
1. Merge `hotfix/defect-exchange-preset-contract-visibility` into `main` first.
2. Rebase or merge `feat/defect-exchange-wizard-flow` on top.

If merged out of order, `feat/defect-exchange-wizard-flow` will silently drop the PHONE_NEW preset-contract fix.

---

## Recommendation

**APPROVE** — Pure frontend UI refactor with no security, money, or data-integrity concerns. Uses correct patterns (`useQuery`, `api.get()`, design tokens). Wizard step-gate logic is sound. No backend changes.

_Merge after hotfix branch is merged first (see Dependency note above)._
