# Pre-Merge Guard Report — fix/cpa-template-spec-fk-cleanup

**Date**: 2026-05-08  
**Branch**: `fix/cpa-template-spec-fk-cleanup`  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Files | +Lines | -Lines |
|-------|--------|--------|
| 15 test spec files (all in `apps/api/src/modules/journal/`) | +187 | 0 |

All changes are in `*.spec.ts` files — no production code touched.

---

## What This Branch Does

Extends the `beforeAll`/`setup` teardown in 15 CPA template spec files to delete FK-child tables before deleting `Payment`, `InstallmentSchedule`, and `Contract`. This is required because v3 hardening changed Payment FK relations from `Cascade` to `Restrict` — the old teardown order would fail with FK constraint violations when those child tables have rows.

New deletions added (in order before `Payment`):
- `receipt`, `eDocument`, `signature`, `contractDocument`
- `partialPaymentLink`, `warrantyAuditLog`, `badDebtWriteOffAuditLog`
- `promiseSlot`, `callLog`, `dunningAction`, `repossession`

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

Pure test infrastructure fix. No production code changes, no security surface, no business logic. The deletions correctly respect FK constraint order introduced by the v3 Cascade→Restrict migration. Safe to merge.
