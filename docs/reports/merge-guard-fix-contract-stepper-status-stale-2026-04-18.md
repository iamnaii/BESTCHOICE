# Merge Guard Report — fix/contract-stepper-status-stale

**Date**: 2026-04-18  
**Branch**: `fix/contract-stepper-status-stale`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `apps/web/src/pages/ContractDetailPage.tsx` | 10 | 5 |
| **Total** | **10** | **5** |

### Change Description
Fixes stale workflow UI in `ContractDetailPage` where the "ส่งตรวจสอบ" (Submit for Review) button remained visible and actionable after the contract had already been submitted (i.e., `workflowStatus === 'PENDING_REVIEW'`).

**Two changes in this fix**:

1. **Guard condition tightened**: `canSubmit` now requires `workflowStatus === 'CREATING' || workflowStatus === 'REJECTED'` in addition to `isCreator && allSigned`. Previously the check only tested `isCreator && allSigned`, so after submission the button stayed visible while the status was `PENDING_REVIEW`.

2. **Additional cache invalidation**: Two new `queryClient.invalidateQueries()` calls added after the submit/sign mutations:
   - `['contract-edocuments', id]`
   - `['contract-doc-checklist', id]`
   This ensures document panels update immediately after workflow state changes.

---

## Issues Found

### Critical — None

### Warning — None

### Info

**I1: IIFE inside JSX array**  
- **File**: `ContractDetailPage.tsx` (stepper steps array)  
- **Description**: The fix uses an immediately-invoked function expression `(() => { ... })()` inside the steps array literal to compute the step object. This is functional but non-idiomatic — a named helper or direct ternary would be more readable. Not a bug.

---

## Positive Observations

- **Enum values are correct**: `CREATING`, `PENDING_REVIEW`, `REJECTED` all exist in `ContractWorkflowStatus` enum in `schema.prisma`.
- **`workflowStatus` is typed**: Defined as `string` on the contract type (line 43 of the pre-existing file); the fix is consistent with how the field is used elsewhere in the same file (lines 135, 269, 271, 320).
- **No backend changes** — pure frontend UI state fix.
- **Extra invalidations are safe** — both query keys are used elsewhere in the file; invalidating them eagerly is correct defensive behaviour.

---

## Recommendation

**✅ APPROVE** — Targeted bug fix with no security or logic regressions. The IIFE (Info I1) is cosmetic only.
