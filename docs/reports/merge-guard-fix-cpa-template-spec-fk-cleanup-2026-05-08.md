# Merge Guard Report — fix/cpa-template-spec-fk-cleanup

**Date**: 2026-05-08  
**Branch**: `fix/cpa-template-spec-fk-cleanup`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Merge base**: `9849213f` (PR #771)  
**Commits ahead of main**: 8

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/journal/__tests__/scenario-helpers.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b-split.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/reschedule-jp6.template.spec.ts` | +11 |
| `apps/api/src/modules/journal/cpa-templates/vat-60day-mandatory.template.spec.ts` | +22 |
| `apps/api/src/modules/journal/cpa-templates/vat-60day-reversal.template.spec.ts` | +22 |
| `apps/api/src/modules/journal/cpa-templates/vendor-clearance.template.spec.ts` | +11 |

**Total**: 15 files, +187 lines

## What Changed

Each spec file's `beforeAll`/`beforeEach` cleanup block now deletes Restrict-FK children of `Contract`/`Payment` before the main table cleanup. New deletions added (in dependency order):

```
receipt → eDocument → signature → contractDocument →
partialPaymentLink → warrantyAuditLog → badDebtWriteOffAuditLog →
promiseSlot → callLog → dunningAction → repossession →
payment → installmentSchedule → contract
```

This matches the `onDelete: Restrict` chain added in v3 and extended in v5 (PromiseSlot, PartialPaymentLink). Without this fix, spec teardown was failing with FK constraint violations when `partialPaymentLink` and related v5 models existed.

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info
_None_

---

## Recommendation: ✅ APPROVE

Pure test infrastructure fix — no production code changed. Correctly extends the FK cleanup order to cover models added in v5. No security, logic, or pattern concerns.
