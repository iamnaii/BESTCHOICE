# Merge Guard Report — fix/payment-single-screen

**Date**: 2026-05-05  
**Branch**: `fix/payment-single-screen`  
**Author**: Akenarin Kongdach (iamnaii@gmail.com)  
**Reviewed at**: 2026-05-05T11:16 UTC  
**Recommendation**: ⚠️ REVIEW — inherits W-1 and W-2 from base branch; fix before merge

---

## Context

This branch is a **superset** of `fix/installment-schedules-on-activate` with one additional commit:

```
15b55909 fix(wizard): collapse 4-step wizard to single screen for fast cashier workflow (#757)
```

All issues from `merge-guard-fix-installment-schedules-on-activate-2026-05-05.md` apply here. This report covers only the incremental change (the single-screen collapse).

---

## File Changes (incremental vs fix/installment-schedules-on-activate)

| File | Changes |
|------|---------|
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | +303 / -564 |

**Net effect**: Removes the 4-step `WizardStepper` and step-gating logic. Collapses all fields into a single scrollable form that can be submitted directly.

---

## Issues (incremental)

### Critical
None.

### Warning
None incremental — inherits W-1 and W-2 from base branch.

### Info

#### I-1: Decimal arithmetic in collapsed wizard uses correct approach
The single-screen component continues to use `Decimal.js` for `remaining`, `diff`, and tolerance checks. No regressions observed.

#### I-2: Comment references 4-step wizard in parent index.tsx
**File**: `apps/web/src/pages/PaymentsPage/index.tsx:599`

The comment still reads `{/* Record Payment Wizard (new 4-step UI with live JE preview) */}` after the collapse. Should be updated to reflect single-screen. Minor.

---

## Positive Highlights

- Removes 564 lines of step-navigation boilerplate. Single screen is simpler and testable.
- No new API calls, guards, or DTOs introduced — purely a UI refactor.
- Preserves all form validation and submission paths from the multi-step version.

---

## Overall Recommendation

Fix W-1 (type-safe `case` field on `RecordPaymentDto`) and W-2 (`slipUrl` HTTPS validation) from the base branch before merging either branch. These can be done in one small follow-up commit on this branch. All other items are Info-level and acceptable for merge with inline comments.
