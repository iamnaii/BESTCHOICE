# Pre-Merge Guard Report

**Branch**: `fix/cpa-template-spec-fk-cleanup`
**Author**: Akenarin Kongdach
**Date**: 2026-05-07
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

- **15 files changed**, 187 insertions(+), 0 deletions(-)
- All changes are in `apps/api/src/modules/journal/__tests__/` spec files
- No production code modified

### What changed
Each CPA template spec file (`1a`, `2a`, `2b`, `2b-split`, `jp4`, `jp5`, `jp6`, `vat-60day-mandatory`, `vat-60day-reversal`, `vendor-clearance`, and others) received extended `beforeAll`/`beforeEach` teardown blocks. The additions delete FK-Restrict children before deleting the parent `Contract` or `Payment` rows:

```ts
await prisma.receipt.deleteMany({});
await prisma.eDocument.deleteMany({});
await prisma.signature.deleteMany({});
await prisma.contractDocument.deleteMany({});
await prisma.partialPaymentLink.deleteMany({});
await prisma.warrantyAuditLog.deleteMany({});
await prisma.badDebtWriteOffAuditLog.deleteMany({});
await prisma.promiseSlot.deleteMany({});
await prisma.callLog.deleteMany({});
await prisma.dunningAction.deleteMany({});
await prisma.repossession.deleteMany({});
```

This resolves FK constraint failures when the v5 `PromiseSlot`, `CallLog`, `DunningAction`, and `Repossession` models (added in the promise-to-pay lifecycle redesign) cause teardown to fail because the Restrict FK was added after the original test teardown order was written.

---

## Issues

### 🔴 Critical

None.

### 🟡 Warning

None.

### ℹ️ Info

#### I-1: Repetitive teardown block across 15 files
The same 11-line `deleteMany` block is copy-pasted into each spec file's `beforeAll`/`beforeEach`. A shared `clearContractFixtures(prisma)` helper in a `test-helpers.ts` file would reduce duplication and make future FK additions (when new Restrict-child models are added) a single-file change.

This is a maintainability concern, not a correctness issue — the current approach works correctly.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| Warning  | 0 | — |
| Info     | 1 | Low priority |

## Recommendation: ✅ APPROVE

Clean, focused fix. Correctly extends test teardown to handle FK Restrict constraints introduced by the v5 promise-to-pay lifecycle. No production code changed, no security concerns, no architectural violations.

Safe to merge.
