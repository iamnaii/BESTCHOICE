# Merge Guard Report — fix/cpa-template-spec-fk-cleanup

**Date**: 2026-05-08  
**Branch**: `fix/cpa-template-spec-fk-cleanup`  
**Author**: Akenarin Kongdach  
**Files changed**: 15 (test files only)

---

## Summary

Pure test-fixture maintenance. Adds FK-safe teardown steps to 15 `beforeAll`/`setup` functions across the CPA template spec files. The additions are needed because Payment now has `Restrict` FK constraints on child tables (Receipt, EDocument, Signature, ContractDocument, PartialPaymentLink, WarrantyAuditLog, BadDebtWriteOffAuditLog, PromiseSlot, CallLog, DunningAction, Repossession), which must be deleted before Payment rows can be cleared.

**Affected specs**:
- `scenario-helpers.spec.ts`
- `bad-debt-provision.template.spec.ts`
- `bad-debt-writeoff.template.spec.ts`
- `contract-activation-1a.template.spec.ts`
- `defect-exchange-reversal.template.spec.ts`
- `early-payoff-jp4.template.spec.ts`
- `installment-accrual-2a.template.spec.ts`
- `payment-receipt-2b-split.template.spec.ts`
- `payment-receipt-2b.template.spec.ts`
- `receipt-void-reversal.template.spec.ts`
- `repossession-jp5.template.spec.ts`
- `reschedule-jp6.template.spec.ts`
- `vat-60day-mandatory.template.spec.ts` (2 teardown blocks)
- `vat-60day-reversal.template.spec.ts` (2 teardown blocks)
- `vendor-clearance.template.spec.ts`

---

## Issues by Severity

### Critical
_None_

### Warning
_None_

### Info
- Teardown order is consistent and correct: JournalLine → JournalEntry → child tables → Payment → InstallmentSchedule → Contract. No FK violations expected.

---

## Recommendation: ✅ APPROVE

No production code changed. Test-only fix that unblocks the CPA template test suite from FK constraint failures introduced by the v3 Cascade→Restrict migration (PR #439). Safe to merge.
