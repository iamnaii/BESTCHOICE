# Merge Guard Report — feat/a1-d1.1.3.2-wht-rates

**Date**: 2026-05-20  
**Branch**: `feat/a1-d1.1.3.2-wht-rates`  
**Author**: Akenarin Kongdach / iamnaii <akenarin.ak@gmail.com>  
**Recommendation**: ✅ **APPROVE** — no issues found

---

## File Changes Summary

| File | Lines ± | Notes |
|---|---|---|
| `apps/api/src/modules/settings/settings.service.spec.ts` | +2/-2 | Adds `REPAIR_SERVICE` to DocumentType key assertion |
| `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx` | +2/-9 | Extracts inline WHT filter to helper function |
| `apps/web/src/hooks/useUiFlags.ts` | +2 | Adds `REPAIR_SERVICE: 'RS'` to `documentPrefixes` |
| `apps/web/src/lib/wht-rates.test.ts` | +93 | New Vitest test file — full coverage |
| `apps/web/src/lib/wht-rates.ts` | +66 | New pure helper: `filterActiveWhtRates` + `whtRatesToSelectOptions` |
| `docs/superpowers/tracking/D1-settings-implement.md` | +4/-2 | Tracking doc update |

**6 files changed, 169 insertions(+), 13 deletions(-)**

---

## Issues Found

### Critical (0)

None.

### Warning (0)

None.

### Info (0)

None.

---

## Summary

This PR is a clean refactoring. The inline WHT-rate filtering logic that previously lived inside `ItemLinesSection.tsx` (a React component) is extracted into a standalone pure-function module `wht-rates.ts` with a comprehensive Vitest test suite (93 lines, 8 test cases).

Key quality observations:
- **No API surface changes** — backend is untouched
- **No mutations** — no `queryClient.invalidateQueries()` concern
- **No raw fetch** — component refactor only touches the WHT options derivation
- **Pure functions** — `filterActiveWhtRates` and `whtRatesToSelectOptions` have no side effects; `now: Date = new Date()` default makes them clock-injectable for testing
- **Permissive fallback** for unparseable `effectiveDate` is correctly documented and tested
- **Test coverage**: boundary case (`effectiveDate === now`), future-date exclusion, mixed input, empty input, and invalid-date fallback all covered
- The `REPAIR_SERVICE: 'RS'` addition to `useUiFlags.documentPrefixes` aligns with the existing `EXPENSE/PAYROLL/VENDOR_SETTLEMENT/PETTY_CASH_REIMBURSEMENT` pattern and is correctly reflected in the backend spec
