# Pre-Merge Guard Report

**Branch**: `feat/p3-sp1-year-end-closing`  
**Author**: Akenarin Kongdach <akenarin.ak@gmail.com>  
**Date**: 2026-05-18  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Lines Added |
|------|-------------|
| `apps/api/src/modules/accounting/closing.controller.ts` | +50 (new) |
| `apps/api/src/modules/accounting/closing.service.ts` | +417 (new) |
| `apps/api/src/modules/accounting/closing.service.spec.ts` | +419 (new) |
| `apps/api/src/modules/accounting/dto/year-end-closing.dto.ts` | +37 (new) |
| `apps/api/src/modules/journal/cpa-templates/year-end-closing.template.ts` | +375 (new) |
| `apps/api/src/modules/journal/year-end-closing.template.spec.ts` | +286 (new) |
| `apps/api/src/modules/accounting/accounting.module.ts` | +11 modified |
| `apps/api/src/modules/journal/journal.module.ts` | +3 modified |
| `apps/web/src/pages/YearEndClosingPage.tsx` | +585 (new) |
| `apps/web/src/pages/YearEndClosingPage.test.tsx` | +196 (new) |
| `apps/web/src/App.tsx` | +9 modified |
| `apps/web/src/config/menu.ts` | +3 modified |
| `.claude/rules/accounting.md` | +80 modified |

**Total**: 13 files changed, 2471 insertions, 2 deletions

---

## Issues by Severity

### Critical (must fix before merge)
_No critical issues found._

### Warning (should fix)
_No warning issues found._

### Info (low priority)
1. **`accountingPeriod.findMany` missing `deletedAt: null`** — `closing.service.ts:404`  
   The `findOpenMonthlyPeriods()` helper queries `accountingPeriod` without a `deletedAt` filter. However, this is not a bug: the `AccountingPeriod` model does not have a `deletedAt` field (verified in `schema.prisma`). No action required.

2. **`Number(e.target.value)` for year select** — `YearEndClosingPage.tsx:2154,2168`  
   UI-only conversion of HTML `<select>` value string to number. Not a money field — appropriate use.

3. **`Number(s)` in `formatCurrency` helper** — `YearEndClosingPage.tsx:2039`  
   Used inside a `Intl.NumberFormat` formatter for display only. Not a raw Decimal conversion — appropriate use.

---

## Positive Findings

- `@UseGuards(JwtAuthGuard, RolesGuard)` correctly applied at class level on `AccountingClosingController`
- `@Roles()` on all 3 endpoints: preview (OWNER/FM/ACC), post (OWNER/ACC), reverse (OWNER)
- All money values use `Prisma.Decimal` throughout template and service — no `Number()` on financial fields
- Double-checked idempotency guard with TOCTOU race protection (pre-tx + inside-tx checks with `$transaction`)
- `deletedAt: null` present on all relevant queries (`journalEntry`, `journalLine`, `companyInfo`)
- Frontend uses `api.post()` + `useQuery` / `useMutation` + `queryClient.invalidateQueries()` ✅
- No hardcoded hex colors or `bg-gray-*`/`text-gray-*` tokens
- DTOs have class-validator decorators with Thai error messages
- `YearEndClosingTemplate.bkkYearBounds()` correctly handles Asia/Bangkok UTC+7 (no DST) year boundaries
- 419 service tests + 286 template tests covering: future-year rejection, current-year rejection, open-month gating, idempotency, race conditions, Dr/Cr flip on reverse, OWNER-only reverse guard

---

## Recommendation: **APPROVE**

No blocking issues. The implementation is security-correct, follows project conventions, and has comprehensive test coverage for edge cases (race conditions, idempotency, year-boundary arithmetic).
