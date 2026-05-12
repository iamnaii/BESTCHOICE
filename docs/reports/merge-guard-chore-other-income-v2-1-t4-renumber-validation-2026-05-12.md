# Merge Guard Report — chore/other-income-v2-1-t4-renumber-validation

**Date:** 2026-05-12  
**Branch:** `chore/other-income-v2-1-t4-renumber-validation`  
**Author:** Akenarin Kongdach  
**Recommendation:** ✅ APPROVE

---

## Summary

Single commit (T4 task). Reorders validation rules in `ValidationService.validate()` to match the accountant's PDF Spec v1.0 numbering (V1–V15), and adds an authoritative JSDoc block mapping each rule to its spec reference. Pure documentation/structural change — no logic altered.

## File Changes (1 file, +68 / -41)

| File | Changes |
|------|--------|
| `services/validation.service.ts` | Rule reordering + JSDoc, no logic change |

---

## Issues

### Critical — 0 found

### Warning — 0 found

### Info — 1 item

**I-1: Rule execution order changed (V11 moved earlier, V15 moved later)**

- **Before**: V3 → V4 → V7 → V15 → V6 → V8 → V10/V12 → V13/V14 → V11  
- **After**: V3 → V4 → V6 → V7 → V8 → V11 → V10/V12 → V13/V14 → V15

Since all rules push to `errors[]`/`warnings[]` arrays with no early returns, the final `ValidationResult` is identical regardless of evaluation order. The reordering is safe. The new order also more closely matches the spec numbering, which aids auditability.

---

## Positive Findings

- **Spec alignment**: The new JSDoc block explicitly maps each `V-number` to the accountant's PDF spec (with notes for rules V1/V2/V5/V9 that are intentionally not implemented here and why). This is audit-trail documentation at the code level.
- **V9 note**: Correctly documents that Maker ≠ Approver (V9) is enforced in `OtherIncomeService.approve()`, not in the validator — avoids duplication and explains the absence.
- **No functional regression risk**: Pure structural/docs change, all checks still present and logically equivalent.
