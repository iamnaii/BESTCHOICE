# Merge Guard Report — fix/expenses-6-critical-gl-bugs

**Date**: 2026-05-16  
**Branch**: `fix/expenses-6-critical-gl-bugs`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: `docs(expenses): I1 + I2 — V15 exemption JSDoc + SSO cap TODO` (2026-05-15 00:54 +0700)  
**Commits ahead of main**: 7  
**Diff size**: 23 files changed, +1,822 / -111 lines  

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/expense-documents/expense-documents.service.ts` | Modified — C12 symmetry guard across all 4 doc types, V15 WHT-at-ACCRUAL rejection |
| `apps/api/src/modules/expense-documents/services/doc-number.service.ts` | Modified |
| `apps/api/src/modules/expense-documents/services/je-preview.service.ts` | Modified |
| `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts` | Modified — C11: `@Max(750)` SSO cap |
| `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts` | Modified — C12: strict WHT form type routing |
| `apps/api/src/modules/journal/cpa-templates/expense-accrual.template.ts` | Modified — C12 symmetry |
| `apps/api/src/modules/journal/cpa-templates/credit-note.template.ts` | Modified — C12 symmetry |
| `apps/api/src/modules/journal/cpa-templates/vendor-settlement.template.ts` | Modified |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Modified |
| `apps/api/src/modules/journal/utils/wht-form-type.ts` | **New** — `assertWhtFormType` narrowing utility |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | Modified |
| `apps/web/src/pages/PaymentVoucherPage.tsx` | Modified |
| `apps/web/src/pages/PaymentVoucherPage.test.tsx` | New — 110-line test |
| (8 backend spec/integration test files) | New/modified — 334+ lines of new tests |

---

## Issues by Severity

### Critical (0 issues)

None found.

- No new controllers added — no guard check required.
- All new DTO validation decorators include Thai error messages (e.g. `'SSO ต่อคนไม่เกิน 750 บาท/เดือน (5% × 15000 ceiling)'`). ✅
- `Number.isFinite(Number(rawThreshold))` in `expense-documents.service.ts` is a config-value guard (`rawThreshold` is a string from `SystemConfig`), not a financial arithmetic path. ✅
- No `$queryRaw` with string interpolation.
- No hardcoded secrets.
- New `wht-form-type.ts` utility uses `throw new BadRequestException(...)` on invalid form type — no silent fallback. ✅

### Warning (1 issue)

**W1 — `expense-documents.service.ts` C12 guard applies only to `ACCRUAL → POSTED` transition**

The new C12 symmetry guard rejects WHT routing issues across all 4 doc types. However, the guard fires at `post()` time. If a user creates a doc with a per-line `whtFormType = null` and no document-level `whtFormType`, the error only surfaces at post — not at save/create. This is consistent with the existing V15 pattern but means a user can create a semantically invalid doc and only discover the error later. Consider adding a `@IsIn(['PND3', 'PND53'])` validator to the per-line DTO, or at minimum ensure the `je-preview.service.ts` surfaces this error in the JE preview step so the user sees it before posting.

### Info (3 items)

**I1 — `assertWhtFormType` centralises a previously repeated pattern**  
New `apps/api/src/modules/journal/utils/wht-form-type.ts` replaces 4 inline type casts with a single throwing utility. Good SSOT. Ensure the utility is covered by `wht-form-type.spec.ts` (the spec file is listed as new). ✅

**I2 — `create-payroll.dto.ts` SSO cap hardcoded at 750**  
The `@Max(750)` cap is Thai SSO law (5% × 15,000). The TODO comment in the file flags that if the SSO cap changes, this needs updating alongside `payroll.template.ts`. Low risk given it matches current Thai law, but flagged for awareness.

**I3 — Large branch: +1,822 lines**  
Most additions are test coverage (8 spec files + `PaymentVoucherPage.test.tsx`). The ratio of test to production code is healthy.

---

## Recommendation

**✅ APPROVE**

The branch fixes 6 confirmed expense GL bugs including the critical WHT misrouting issue (C12 — previously silently booked WHT under PND3 when form type was ambiguous, now throws a `BadRequestException` with a clear message). The SSO cap enforcement (C11) correctly applies Thai law. All 4 CPA templates receive consistent C12 hardening. Error handling is thorough. New test coverage is substantial (+334 lines of service tests, +110 lines of page tests, +86 lines of util tests). The W1 warning (JE preview not surfacing WHT routing errors early) is a UX improvement, not a data correctness issue — safe to defer.
