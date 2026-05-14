# Merge Guard Report — feat/other-income-v2-2-pr1-override-jv-pagination

**Date**: 2026-05-14  
**Branch**: `feat/other-income-v2-2-pr1-override-jv-pagination`  
**Author**: Akenarin Kongdach  
**Last commit**: `808dd526` — docs(accounting): companion HTML for v2.2 accountant sign-off  
**Base**: `origin/main`

---

## File Changes Summary

56 files changed, 5924 insertions(+), 478 deletions(−)

**Backend (API)**
- `accounting.controller.ts` — +10/−2: new `GET /accounting/periods/reopened` endpoint + `ip` on reopen
- `reopen-period.dto.ts` — new `ReopenPeriodDto` with reason/taxFiled fields
- `monthly-close.service.ts` — +140/−?: `listReopenedPeriods`, `reopenPeriod` signature update
- `other-income.controller.ts` — +21: `PUT /other-income/maker-checker`, `GET /other-income/maker-checker/pending-ready-count`
- `other-income.service.ts` — +181/−?: `setMakerCheckerEnabled`, `pendingReadyCount`, `listWithPagination`, override JV logic
- `journal-override.service.ts` — new file: V1/V2/V5 validation, diff summary

**Frontend (Web)**
- `SettingsPage/index.tsx` — refactored into 5-tab hub (company/vat/periods/attachment/users)
- `SettingsPage/tabs/*.tsx` — 5 new tab components extracted
- `ReopenPeriodModal.tsx` — new modal for period reopen with reason fields
- `ReopenedPeriodBanner.tsx` — new banner shown on OtherIncome + Expenses pages
- `EditableJournalTable.tsx` — new JV override editing UI
- `OverrideConfirmDialog.tsx` — new confirm dialog for JV override
- `MakerCheckerToggle.tsx` / `MakerCheckerConfirmDialog.tsx` — new maker-checker controls
- `PaginationBar.tsx` + `usePaginationParams.ts` — reusable pagination components
- Various test files + E2E spec

**Docs/Specs**: 3 companion docs added (`.md` + `.html`)

---

## Issues Found

### Critical
_None found._

### Warning

**W1 — `any` casts on `log.oldValue` / `log.newValue` in `AuditLogsPage.tsx`**
```tsx
// apps/web/src/pages/AuditLogsPage.tsx (added lines)
{(log.newValue as any)?.diffSummary ?? '(ไม่มีสรุปการเปลี่ยนแปลง)'}
{(log.oldValue as any)?.jvLines?.map((l: any, i: number) => (
```
The `AuditLog.oldValue`/`newValue` are `Json` in Prisma — casting via `as any` is technically correct here but fragile. Should use a typed discriminated union or helper `parseAuditPayload<JvOverridePayload>()` to avoid silent regressions when the shape changes.

**W2 — `onError: (err: any)` in `OtherIncomeEntryPage.tsx` and `ReopenPeriodModal.tsx`**
```tsx
onError: (err: any) => {
  const apiErrors = (err as any)?.response?.data?.message;
```
This pattern exists elsewhere in the codebase too, but the new code adds 2 more occurrences. Consider extracting `getApiErrorMessage(err)` from `@/lib/api` to centralise and type the axios error shape.

**W3 — `SettingsPage/index.tsx` now 192 lines added/rewritten**
The file is being heavily restructured. After this PR lands, `SettingsPage/index.tsx` becomes the 5-tab hub. Consider a follow-up to verify the total file length doesn't exceed 500 lines (current project soft limit).

### Info

**I1 — Test-only `password: 'x'` in spec fixture**
```ts
// apps/api/src/modules/other-income/__tests__/pagination-perf.spec.ts
password: 'x',
```
Not a production issue — placeholder for Prisma upsert test setup. Confirmed to be inside a `.spec.ts` file.

**I2 — `(accountingApi.listReopenedPeriods as any).mockResolvedValue(...)` in test**
3 occurrences in `ReopenedPeriodBanner.test.tsx`. The mock typing can be improved with `jest.mocked()`, but this is a test-quality issue only.

**I3 — New `PaginationBar` component added without Storybook story**
Minor — not required by project conventions but could aid discoverability.

---

## Guard Checks

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ Inherited at class level |
| All new endpoints have `@Roles(...)` | ✅ Both new endpoints have `@Roles('OWNER')` |
| `Number()` on money/Decimal fields | ✅ None found — `Decimal` used throughout `JournalOverrideService` |
| `deletedAt: null` in new queries | ✅ Present on `pendingReadyCount` and `list` queries |
| Hardcoded secrets / API keys | ✅ None (test fixture `password: 'x'` is benign) |
| Raw `fetch()` in frontend | ✅ All calls use `api.get/put/post` from `@/lib/api` |
| `queryClient.invalidateQueries()` after mutations | ✅ All new mutations invalidate appropriate query keys |
| DTO validation decorators (Thai messages) | ✅ `ToggleMakerCheckerDto`, `ReopenPeriodDto` both have Thai `message:` strings |
| SQL injection (`$queryRaw` unparameterized) | ✅ None found |

---

## Recommendation: **APPROVE** (with optional follow-ups)

No blocking issues. The two warnings (W1, W2) are `any` typing patterns that already exist in the codebase — this PR doesn't introduce a new anti-pattern, just extends existing ones. W3 is a structural note for a future cleanup.

Suggested follow-up (non-blocking):
- Extract `getApiErrorMessage(err: unknown): string` utility into `@/lib/api`
- Type `AuditLog.oldValue/newValue` payload with a discriminated union per `action` string
