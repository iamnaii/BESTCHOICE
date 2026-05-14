# Pre-Merge Guard Report

**Branch**: `feat/other-income-v2-2-pr1-override-jv-pagination`
**Author**: Akenarin Kongdach
**Date**: 2026-05-14
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

56 files changed, 5924 insertions(+), 478 deletions(-)

### Key areas touched
- `apps/api/src/modules/accounting/accounting.controller.ts` — new `GET periods/reopened` endpoint
- `apps/api/src/modules/accounting/dto/reopen-period.dto.ts` — extended DTO (reasonType, taxFiled, boardResolutionId now optional)
- `apps/api/src/modules/accounting/monthly-close.service.ts` — CAS reopen via `updateMany`, PERIOD_CLOSED/PERIOD_REOPENED audit via AuditService
- `apps/api/src/modules/other-income/other-income.controller.ts` — new `PUT maker-checker`, `GET maker-checker/pending-ready-count`
- `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` — Override JV UI, editable journal table
- `apps/web/src/pages/SettingsPage/` — 5-tab settings hub (company, vat, periods, attachment, users)
- `apps/web/src/components/ui/PaginationBar.tsx` — new shared pagination component
- `apps/web/src/components/accounting/ReopenedPeriodBanner.tsx` — reopen warning banner

---

## Issues Found

### Critical (0)

None.

### Warning (2)

**W-1 — `Number()` on financial values in override JV snapshot**
- File: `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`
- Pattern:
  ```ts
  debit: Number(Number(l.debit).toFixed(2)),
  credit: Number(Number(l.credit).toFixed(2)),
  ```
- These values are stored in `overrideLines: EditableJournalLine[]` state and sent directly to the API as JSON numbers via `overrideLines.map(l => ({ debit: l.debit, credit: l.credit }))`. The server-side `JournalOverrideService` receives plain `number`, not `Decimal`. Precision is constrained by `toFixed(2)` but the pattern breaks the Decimal-throughout convention and could cause floating-point drift on values like 333.33 * 3. Server V1 balance validation catches mismatches, but the UI user would see a confusing "unbalanced" rejection on a value they didn't change.
- **Fix**: Store as `string` (`l.debit.toFixed(2)`) and cast to `Prisma.Decimal` in the API DTO.

**W-2 — `console.log` in performance test seeder**
- File: `apps/api/src/modules/other-income/__tests__/pagination-perf.spec.ts`
- Lines: `console.log(`Seeded ${rows.length}...`)`, `console.log(`Page 1 query took ${ms}ms`)`
- The test is in a `describe.skip` block guarded by `PERF=1`, so CI is safe. However, if the skip is lifted, CI logs will emit these prints. Low risk but inconsistent with test conventions.
- **Fix**: Use `process.stdout.write` or logger, or delete these (timing is visible from test output anyway).

### Info (3)

**I-1 — New endpoints have correct guards**
- `GET /accounting/periods/reopened` → `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` ✓
- `PUT /other-income/maker-checker` → `@Roles('OWNER')` ✓
- `GET /other-income/maker-checker/pending-ready-count` → `@Roles('OWNER')` ✓
- Controller-level `@UseGuards(JwtAuthGuard, RolesGuard)` already present on both controllers ✓

**I-2 — Period reopen CAS is well-tested**
- 4 new tests covering: normal reopen, stale period without boardResolutionId, stale period with boardResolutionId, CAS race (another request wins first), CAS with unexpected intermediate status → ConflictException.

**I-3 — SettingsPage is large (~700 lines) but well-structured**
- Tabs are separate files; the index is primarily routing and tab wiring. Acceptable size.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers have JwtAuthGuard | ✅ Both controllers already have class-level guard |
| All new endpoints have @Roles | ✅ |
| Number() on money fields (backend) | ✅ None found in service/controller layer |
| Missing deletedAt: null in queries | ✅ `listReopenedPeriods` filters `status: 'OPEN'` (no soft-delete issue on AccountingPeriod) |
| Hardcoded secrets/keys | ✅ None found |
| SQL injection ($queryRaw unparameterized) | ✅ None found |
| Raw fetch() in frontend | ✅ All API calls use `api.get()`/`api.post()` via `otherIncomeApi` wrapper |
| Mutations missing invalidateQueries | ✅ 9 invalidateQueries calls found |

---

## Recommendation

**REVIEW** — No critical security or data integrity issues. One warning (W-1) is worth fixing before merge because the `Number()` conversion on override lines breaks the Decimal convention and could cause V1 balance errors that confuse users. W-2 is cosmetic.

Suggest author fix W-1 (`toFixed(2)` string → server Decimal conversion in DTO) then re-review.
