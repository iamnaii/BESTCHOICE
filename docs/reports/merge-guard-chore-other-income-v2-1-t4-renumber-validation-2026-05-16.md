# Merge Guard Report — `chore/other-income-v2-1-t4-renumber-validation`

**Date**: 2026-05-16  
**Author**: Akenarin Kongdach  
**Branch**: `chore/other-income-v2-1-t4-renumber-validation` vs `main`  
**Commits**: 1  
**Files changed**: 1 (+68 / −41)

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/other-income/services/validation.service.ts` | +68 / −41 — rule reorder + JSDoc |

---

## Issues Found

### Critical — None ✅

### Warning — None ✅

### Info

- **Execution order of V11 changed**: attachment check (V11) was previously the last rule evaluated; it now runs before V10/V12 (reconciliation). Both are blocking errors, so users with both issues will now see V11 before V10. No behavioral regression — validation still blocks the same invalid states.
- All 15 validation rules (V3–V15) are present after the refactor. No rules removed or weakened.

---

## What Changed

Pure refactor of `ValidationService.validate()`:

1. **Rule execution order** aligned to PDF Spec v1.0 (`2026-05-12-other-income-v2-1-pdf-gap-fixes-design.md`): V3 → V4 → V6 → V7 → V8 → V11 → V10/V12 → V13/V14 → V15.
2. **JSDoc block** added above the class documenting all 15 rules with their spec numbers, N/A explanations for journal-layer rules (V1/V2/V5/V9), and the BESTCHOICE-specific V15 extension.
3. No logic changes — same `errors` and `warnings` arrays, same push conditions, same return shape.

---

## Recommendation

**APPROVE** ✅

Purely cosmetic/documentation change. No security surface, no behavioral risk. The execution-order shift for V11 is harmless — both validation errors are blocking, so the user experience difference is which error message appears first when both conditions are violated.
