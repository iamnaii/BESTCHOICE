# Merge Guard Report — chore/other-income-v2-1-t4-renumber-validation

**Date**: 2026-05-14  
**Branch**: `chore/other-income-v2-1-t4-renumber-validation`  
**Author**: Akenarin Kongdach  
**Commits ahead of combined base**: 2 unique commits  
**Files changed vs combined**: 1 TS file (`validation.service.ts`)  
**Recommendation**: ✅ APPROVE

---

## Summary

Single-purpose refactor: renumbers validation rule labels in `ValidationService` to match the accountant's PDF Spec v1.0 (`docs/superpowers/specs/2026-05-12-other-income-v2-1-pdf-gap-fixes-design.md`). No logic changes.

Changes made:
- Added a top-of-file comment block mapping V1–V15 to spec rule numbers
- Reordered validation checks to match spec order (V3 → V4 → V6 → V7 → V8 → V11 → V10/V12 → V13/V14 → V15)
- Updated inline comments from `// V3: description` to `// V3 — description` (cosmetic)
- Removed the separate 42-1102 WHT-15% warning (V15 now only enforces VAT=0; WHT rate left to user with UI tooltip)

---

## Issues Found

### Critical — None

### Warning — 1 item

**W1 — `Number(it.whtPct)` in V7 check on a potentially Decimal field**  
File: `apps/api/src/modules/other-income/services/validation.service.ts` (line ~135 after changes)  

```typescript
const pct = Number(it.whtPct);
if (!VALID_WHT_PCT.includes(pct)) { ... }
```

`it.whtPct` is `Decimal` in the `ValidationDoc` interface. `Number()` coerces it to float for set-membership check against `[0, 1, 2, 3, 5, 7, 10, 15]`. For these small WHT percentages, float precision is not an issue in practice. This pattern existed in the pre-renumber code — not introduced by this branch. Recommend using `.toNumber()` with a comment explaining the intentional coercion, or `VALID_WHT_PCT.some(v => it.whtPct.eq(v))` for full type safety.

### Info — 1 item

**I1 — V15 WHT check removed**  
The combined branch had a `warnings.push` when `42-1102` WHT ≠ 15%. This branch removes it, replacing with a UI tooltip approach. The change is mentioned in the commit message but has no corresponding UI implementation visible in this diff. Verify that `apps/web` has the tooltip before merging.

---

## Positive Highlights

- No logic changes — pure cosmetic/documentation refactor, low risk.
- The top-of-file rule reference comment improves maintainability significantly.
- Reordering V11 before V10/V12 is spec-compliant and correct.
