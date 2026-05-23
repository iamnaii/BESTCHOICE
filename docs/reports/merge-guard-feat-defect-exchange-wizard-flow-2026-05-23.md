# Pre-Merge Guard Report

**Branch**: `feat/defect-exchange-wizard-flow`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Date**: 2026-05-23
**Reviewer**: Pre-Merge Guard Agent

---

## File Changes Summary

| File | Insertions | Deletions | Notes |
|------|-----------|-----------|-------|
| `apps/web/src/pages/DefectExchangePage.tsx` | +286 | -149 | Main change: 3-step wizard refactor |
| `apps/web/package.json` | +1 | -1 | Minor dep update |
| seed file | ~10 | 0 | Test data for PHONE_USED exchange |

**Total**: 3 files changed, 286 insertions(+), 149 deletions(-)

---

## Issues Found

### Critical
_None found._

### Warning

**W1 — `elig` possibly `undefined` when advancing from Step 1 with `bypassWindow`**
- File: `apps/web/src/pages/DefectExchangePage.tsx`
- `canNextFrom1 = !!selectedContractId && (elig?.eligible || bypassWindow)` — When `bypassWindow=true` and eligibility query hasn't resolved yet (`elig` is `undefined`), the "ต่อไป" button will be enabled before `eligibilityQ` fetches. This is intentionally permitted for OWNER/BM, but **no loading state is shown** for the eligibility query on Step 1. If the API is slow, the user sees no indicator that eligibility data is being fetched.
- Mitigation already in place: `bypassWindow` is role-gated (`canExecute`) so only OWNER/BM see this path. Not a security issue, but a UX gap.

**W2 — Products limit reduced from 300 → 200 without UI feedback**
- File: `apps/web/src/pages/DefectExchangePage.tsx:120`
- `/products?status=IN_STOCK&category=PHONE_USED&limit=200` — correct fix (matches `PaginationDto @Max(200)`), but if there are more than 200 matching replacement devices no message is shown in the dropdown.

### Info

**I1 — File size approaching threshold**
- `DefectExchangePage.tsx` is ~430 lines after the refactor. Still under the 500-line guideline but worth monitoring as the exchange flow grows.

**I2 — `subtitle={undefined}` passed to PageHeader**
- File: `apps/web/src/pages/DefectExchangePage.tsx:189`
- Passing `undefined` explicitly to `subtitle` is harmless but inconsistent with pages that simply omit the prop. No functional impact.

**I3 — Step 1 skipped when `presetContractId` is set, but eligibility query still fires**
- `eligibilityQ` is enabled when `selectedContractId` is set (preset path). Since the user skips Step 1, the eligibility banner is never rendered. The query runs but its result goes unused in the happy path. Low impact — just a spurious API call.

---

## Summary

The refactor correctly implements a 3-step wizard pattern mirroring `CreateInsuranceWizardPage`. Security posture is unchanged: `bypassWindow` is frontend-gated to OWNER/BM and the backend also enforces this server-side. No missing guards, no money `Number()` coercions, no raw `fetch()`, no hardcoded secrets.

**Recommendation: APPROVE**

The warnings are minor UX issues that don't block a safe merge. W1 is worth a follow-up ticket.
