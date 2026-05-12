# Pre-Merge Guard Report

**Branch:** `chore/other-income-v2-1-t4-renumber-validation`
**Author:** Akenarin Kongdach
**Date:** 2026-05-12
**Reviewer:** Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/modules/other-income/services/validation.service.ts` | +68 | -41 | Reorder rules + new header comment block |

**Total:** 1 file, +68 / -41

---

## Issues Found

### Critical
None.

### Warning
None.

### Info

**[I-1] V11 moved before V10/V12 — minor output ordering change**
- Old order: `V3 → V4 → V6 → V7 → V8 → V10/V12 → V13/V14 → V11 → V15`
- New order: `V3 → V4 → V6 → V7 → V8 → V9 (comment) → V11 → V10/V12 → V13/V14 → V15`
- All rules push to `errors[]` with no early return — all validations run regardless of prior errors.
- The only observable effect is that when both an attachment violation and a reconciliation error exist, V11 now appears first in `errors[]`. This does not affect UI behavior if errors are displayed as a list.
- Aligns to PDF Spec v1.0 rule numbering (`docs/superpowers/specs/2026-05-12-other-income-v2-1-pdf-gap-fixes-design.md`).

**[I-2] V9 comment added (Maker ≠ Approver)**
- Adds an inline comment noting that V9 is enforced in `OtherIncomeService.approve()` not in this validator.
- Documents the deliberate design choice — validation only sees DRAFT docs before the approval step.
- No behavior change.

---

## Notable Quality Improvements

- **Header comment block** explaining all 15 validation rules aligned to the accountant's PDF spec. Makes it trivially easy to audit rule coverage vs. spec requirements.
- **Cleaner inline comments** on each rule block (`// V3 — ...`, `// V4 — ...`) replace the previous inconsistent comment style.

---

## Recommendation

**APPROVE**

Pure documentation/readability improvement with no logic changes. The rule reordering is cosmetic — all rules execute unconditionally. Header comment adds meaningful traceability to the accountant spec.
