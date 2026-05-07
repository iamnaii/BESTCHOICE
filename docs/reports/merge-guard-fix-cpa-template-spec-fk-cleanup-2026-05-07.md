# Merge Guard Report — fix/cpa-template-spec-fk-cleanup

**Date**: 2026-05-07  
**Branch**: `fix/cpa-template-spec-fk-cleanup`  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Files | Insertions | Deletions |
|-------|-----------|-----------|
| 15 (spec files only) | +187 | 0 |

All changes are in `apps/api/src/modules/journal/**/*.spec.ts` — no production code modified.

### What changed
Every `setup()` / `beforeAll()` teardown in 15 CPA template spec files now deletes FK-child rows before the parent `payment`, `installmentSchedule`, and `contract` rows. Added in FK-safe order:

```
receipt → eDocument → signature → contractDocument →
partialPaymentLink → warrantyAuditLog → badDebtWriteOffAuditLog →
promiseSlot → callLog → dunningAction → repossession →
payment → installmentSchedule → contract
```

**Motivation**: v5 (PR #__ Promise-to-Pay lifecycle) added `PromiseSlot`, `CallLog`, `PartialPaymentLink`, etc. as `Restrict`-FK children of `Payment`/`Contract`. Without this cleanup order, integration tests that share a real DB would fail with FK-violation errors on teardown when other test suites left residual rows.

---

## Issues

### Critical
_None_

### Warning
_None_

### Info
_None_

---

## Verdict

**✅ APPROVE**

Pure test infrastructure fix. Correct FK deletion order. No production code changes. No security surface.
