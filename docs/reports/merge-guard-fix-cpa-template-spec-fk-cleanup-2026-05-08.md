# Merge Guard Report — `fix/cpa-template-spec-fk-cleanup`

**Date**: 2026-05-08  
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local  
**Commits**: 2 (test-only)

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/journal/__tests__/scenario-helpers.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b-split.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/reschedule-jp6.template.spec.ts` | +11 lines |
| `apps/api/src/modules/journal/cpa-templates/vat-60day-mandatory.template.spec.ts` | +22 lines |
| `apps/api/src/modules/journal/cpa-templates/vat-60day-reversal.template.spec.ts` | +22 lines |
| `apps/api/src/modules/journal/cpa-templates/vendor-clearance.template.spec.ts` | +11 lines |

**15 files changed, 187 insertions(+), 0 deletions(−)**  
**All changes are test files only — no production code modified.**

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info
_None_

---

## Analysis

This branch adds FK-safe teardown ordering to all 15 CPA journal template specs. The `v3` hardening sprint (PR #437) changed `Payment → Contract` and related doc tables from `Cascade` to `Restrict` to prevent accidental evidence deletion. As a result, test `beforeAll`/`beforeEach` teardown routines that previously deleted `payment` first were failing with FK constraint violations.

The fix adds deletions of Restrict-linked children (`receipt`, `eDocument`, `signature`, `contractDocument`, `partialPaymentLink`, `warrantyAuditLog`, `badDebtWriteOffAuditLog`, `promiseSlot`, `callLog`, `dunningAction`, `repossession`) before `payment` and `contract` in the correct dependency order. This is the right fix.

---

## Recommendation: ✅ APPROVE

No production code was changed. All changes are test infrastructure fixes. Safe to merge.
