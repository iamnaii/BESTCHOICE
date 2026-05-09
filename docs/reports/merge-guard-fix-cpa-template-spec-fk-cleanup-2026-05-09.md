# Merge Guard Report — fix/cpa-template-spec-fk-cleanup

**Date**: 2026-05-09  
**Branch**: `fix/cpa-template-spec-fk-cleanup`  
**Author**: Akenarin Kongdach  
**Commits**: 2  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| Files | Insertions | Deletions |
|-------|-----------|----------|
| 15 `.spec.ts` test files | +187 | 0 |

All changes are confined to `apps/api/src/modules/journal/` test files (`*.spec.ts`). No production code was modified.

### What Changed

Each of the 15 affected spec files had their `beforeAll`/`setup` teardown block extended to delete child rows before clearing `Payment` and `Contract` — required because v3 hardening changed `CASCADE` to `RESTRICT` on Payment's FK children. The new delete order is:

```
journalLine → journalEntry → receipt → eDocument → signature → contractDocument →
partialPaymentLink → warrantyAuditLog → badDebtWriteOffAuditLog →
promiseSlot → callLog → dunningAction → repossession → payment → installmentSchedule → contract
```

This prevents FK constraint failures when tests try to wipe contracts that still have RESTRICT-linked child rows.

---

## Issues

### Critical
_None._

### Warning
_None._

### Info
- The `deleteMany` ordering is consistent across all 15 files — good.
- `badDebtWriteOffAuditLog` is deleted before `payment` (correct: FK targets Payment).
- The fix is repetitive (same 11 lines in 15 files). A shared `truncateForJournalSpec(prisma)` helper would reduce duplication — but refactoring is out of scope here.

---

## Recommendation

**✅ APPROVE** — Pure test-teardown fix. Correctness: FK order is valid. No production changes. Safe to merge.
