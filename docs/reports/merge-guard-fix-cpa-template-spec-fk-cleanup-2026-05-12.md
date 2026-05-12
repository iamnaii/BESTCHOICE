# Merge Guard Report — fix/cpa-template-spec-fk-cleanup

**Date**: 2026-05-12  
**Branch**: `fix/cpa-template-spec-fk-cleanup`  
**Author**: Akenarin Kongdach  
**Last commit**: `b64b0ca4` — test(journal/cpa): extend FK cleanup to all Restrict children of Contract (2026-05-07)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 15 |
| Insertions | +187 |
| Deletions | 0 |
| Unique commits ahead of main | 2 |

**All 15 changed files are test spec files** — no production code changes.

**Files changed:**
- `apps/api/src/modules/journal/__tests__/scenario-helpers.spec.ts`
- `apps/api/src/modules/journal/cpa-templates/*.template.spec.ts` (14 spec files)

---

## Issues Found

### Critical — None
### Warning — None
### Info

**I-1 — FK deletion order fix in `beforeEach` cleanup**

All CPA template specs now explicitly delete FK-constrained child tables before `Contract` in their `beforeEach` blocks, fixing test isolation failures that occurred when `Cascade → Restrict` was enforced in v3 hardening (PR #437). The two commits fix:

1. `d5fe4541` — Add `Receipts` deletion before `Payments/Contracts` (first FK layer)
2. `b64b0ca4` — Extend cleanup to all `Restrict` children: `EDocument`, `Signature`, `ContractDocument`, `PartialPaymentLink`, `WarrantyAuditLog`, `BadDebtWriteOffAuditLog`, `PromiseSlot`, `CallLog`, `DunningAction`, `Repossession`, `InstallmentSchedule`

`vat-60day-mandatory.template.spec.ts` and `vat-60day-reversal.template.spec.ts` each get 22 lines of cleanup (larger than the 11-line standard because they also need to clean VAT-related tables).

**I-2 — Pure additive change**

Zero deletions. All existing test assertions are preserved. The cleanup additions run before each test, not after — consistent with the existing `beforeEach` pattern in the codebase.

---

## Recommendation: ✅ APPROVE

Test-only fix with no production code changes. Directly addresses test isolation failures introduced when `onDelete: Restrict` was added to Payment and related models in v3. Low risk, clear purpose.
