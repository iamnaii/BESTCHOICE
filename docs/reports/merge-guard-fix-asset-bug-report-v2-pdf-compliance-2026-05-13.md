# Merge Guard Report — fix/asset-bug-report-v2-pdf-compliance

**Date:** 2026-05-13  
**Reviewer:** Pre-Merge Guard Agent  
**Branch:** `fix/asset-bug-report-v2-pdf-compliance`  
**Author:** Akenarin Kongdach  
**Recommendation:** ✅ APPROVE

---

## Files Changed (5 files, +686 / -38)

| File | Type |
|------|------|
| `apps/api/scripts/verify-asset-orphans.ts` | NEW — DB verification script |
| `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` | MODIFIED — presentation component |
| `apps/web/src/pages/assets/hooks/useAssetCalculation.test.ts` | NEW — vitest test suite |
| `docs/accounting/journey-asset-v3.html` | MODIFIED — documentation |
| `docs/superpowers/specs/2026-05-13-asset-bug-report-v2-fix-design.md` | NEW — fix design doc |

---

## Critical Issues

**None.** All critical checks pass:

- No new controllers → no `@UseGuards` / `@Roles` gaps
- Financial calculations use `Prisma.Decimal` throughout; `Number()` only used for JSON output serialization (safe)
- All `$queryRaw` calls use `Prisma.sql` template tags (parameterized, no SQL injection)
- All Prisma queries include `deleted_at IS NULL` filters
- No hardcoded secrets or API keys

---

## Warnings

**None found.**

- No new DTOs with missing validators
- React component is pure presentation (uses `useFormContext`, no direct API calls)
- No mutations requiring `queryClient.invalidateQueries()`

---

## Info

- `verify-asset-orphans.ts` (112 lines) — well within 500-line limit
- `AssetEntrySection2Cost.tsx` (279 lines) — well within limit
- No `any` usage; proper TypeScript generics throughout
- Test suite covers VAT extraction edge cases and WHT base routing with correct decimal precision (56074.77 + 3925.23 = 60000)
- UI guard added for zero WHT base case (Bug #8 fix)
- Dynamic VAT inclusive/exclusive label (Bug #9 fix)

---

## Recommendation

**APPROVE** — Focused, well-tested bug fixes for Asset module PDF compliance. No security, financial precision, or auth gaps. Safe to merge.
