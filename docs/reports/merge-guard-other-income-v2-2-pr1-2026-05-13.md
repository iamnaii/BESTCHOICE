# Merge Guard Report — feat/other-income-v2-2-pr1-override-jv-pagination

**Date**: 2026-05-13  
**Branch**: `feat/other-income-v2-2-pr1-override-jv-pagination`  
**Author**: Akenarin Kongdach  
**Commits**: 10 (2026-05-13)  
**Recommendation**: ⚠️ REVIEW (fix warnings before merge)

---

## File Changes Summary

56 files changed, 5924 insertions(+), 478 deletions(−)

**Backend (API)**
- `apps/api/src/modules/accounting/accounting.controller.ts` — new `GET /periods/reopened` endpoint
- `apps/api/src/modules/accounting/dto/reopen-period.dto.ts` — enriched DTO with `ReopenReasonType` enum + validation
- `apps/api/src/modules/accounting/monthly-close.service.ts` — `reopenPeriod()` now accepts `ip`, emits PERIOD_CLOSED via AuditService
- `apps/api/src/modules/other-income/other-income.controller.ts` — `PUT /maker-checker` + `GET /maker-checker/pending-ready-count`
- `apps/api/src/modules/other-income/other-income.service.ts` — override JV path refactored to use `JournalOverrideService`
- `apps/api/src/modules/other-income/services/journal-override.service.ts` *(new)* — V1/V2/V5 validation via `Prisma.Decimal`
- `apps/api/src/modules/other-income/dto/list-other-income-query.dto.ts` — pagination params
- `apps/api/src/modules/other-income/dto/toggle-maker-checker.dto.ts` *(new)*
- Tests: `monthly-close.service.spec.ts`, `journal-override.service.spec.ts`, `pagination-perf.spec.ts`

**Frontend (Web)**
- `apps/web/src/App.tsx` — `/accounting/periods` redirect → `/settings#periods`; new settings sub-routes
- `apps/web/src/pages/SettingsPage/index.tsx` — 5-tab hub (company/vat/periods/attachment/users)
- `apps/web/src/pages/SettingsPage/tabs/` — 5 new tab components
- `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` — JV override mode with `EditableJournalTable`
- `apps/web/src/pages/other-income/components/EditableJournalTable.tsx` *(new)* — editable JE with client-side V1/V2/V5
- `apps/web/src/pages/other-income/components/OverrideConfirmDialog.tsx` *(new)*
- `apps/web/src/components/accounting/ReopenedPeriodBanner.tsx` *(new)*
- `apps/web/src/components/ui/PaginationBar.tsx` *(new)*
- `apps/web/src/hooks/usePaginationParams.ts` *(new)*

---

## Issues Found

### Warning

**W1 — `/accounting/periods` ProtectedRoute narrowed to `OWNER` only (access regression)**

File: `apps/web/src/App.tsx`

```diff
- <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
-   <PeriodClosePage />
+ <ProtectedRoute roles={['OWNER']}>
+   <PeriodsRedirect />   {/* redirects to /settings#periods */}
```

`/settings` and `#periods` tab are both OWNER-only. Previously, `FINANCE_MANAGER` and `ACCOUNTANT` could open the accounting periods page directly. After this change they hit a 403 ProtectedRoute redirect instead of landing in the periods view.

The backend endpoint `GET /accounting/periods/:companyId/:year` retains `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` — the data access is unchanged, but the UI path is gone for these two roles.

**Action required**: Either make `/settings#periods` accessible to `FINANCE_MANAGER`/`ACCOUNTANT` (add roles to SettingsPage ProtectedRoute) or create a separate read-only periods view at a different route for those roles.

---

**W2 — `EditableJournalLine.debit/credit` typed as `number` (JS float) for financial amounts**

Files:
- `apps/web/src/pages/other-income/components/EditableJournalTable.tsx:8-10`
- `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`

```ts
// EditableJournalLine type
export type EditableJournalLine = {
  debit: number;   // ← JS float, not Decimal
  credit: number;
};

// Snapshot initialization from API Decimal values
debit: Number(Number(l.debit).toFixed(2)),
credit: Number(Number(l.credit).toFixed(2)),
```

The override lines are submitted to the backend as plain JS numbers (`l.debit`, `l.credit`) and the backend converts them with `new D(l.debit)`. The backend `JournalOverrideService` correctly uses `Prisma.Decimal` for all arithmetic. For amounts within typical installment ranges (< 1,000,000 THB), IEEE 754 double precision will not lose 2-decimal accuracy. However, this violates the project accounting rule of not using float for money fields.

**Action required**: Change the `EditableJournalLine` type to use `string` (not `Decimal` — can't use Prisma runtime in web) for debit/credit. Submit as strings to the API. The API's `new D(l.debit)` will handle string input correctly and avoids any float representation.

---

### Info

**I1 — Branch spans 3 logical PRs (PR-1 Override JV + PR-2 Maker-Checker/Reopen + PR-3 Settings consolidation)**

The branch includes comprehensive doc plans for PR-2 (1335 lines) and PR-3 (907 lines). The code scope is appropriately large given the features, but reviewers should be aware they are looking at 3 cohesive but distinct features.

**I2 — `Number(l.debit).toLocaleString()` used for display only — acceptable**

In `OtherIncomeViewPage.tsx` and `OtherIncomeEntryPage.tsx` (the read-only journal preview table), `Number(l.debit).toLocaleString('th-TH', ...)` is used purely for rendering. This is display formatting, not financial computation, and is acceptable.

---

## Security Checks — PASSED

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ Both `accounting.controller.ts` and `other-income.controller.ts` have class-level guards |
| New endpoints have `@Roles(...)` | ✅ `GET /periods/reopened` → OWNER/FINANCE_MANAGER/ACCOUNTANT; `PUT /maker-checker` → OWNER; `GET /maker-checker/pending-ready-count` → OWNER |
| No `Number()` on backend financial fields | ✅ `journal-override.service.ts` uses `Prisma.Decimal` throughout |
| No raw `$queryRaw` with user input | ✅ None found |
| No hardcoded secrets or API keys | ✅ None found |
| `deletedAt: null` in new queries | ✅ `pendingReadyCount` → `where: { status: 'READY', deletedAt: null }` |
| New frontend mutations have `invalidateQueries` | ✅ All 7 `useMutation` calls have matching `invalidateQueries` |
| No raw `fetch()` in frontend | ✅ All API calls use `api.*` from `@/lib/api` |

---

## Recommendation: ⚠️ REVIEW

Fix **W1** (role access regression on `/accounting/periods`) before merging — FINANCE_MANAGER and ACCOUNTANT should retain UI access to view accounting period status.

Fix **W2** (float typing on financial fields) — change `EditableJournalLine.debit/credit` to `string` type.

Neither issue is a runtime blocker today (data integrity is protected by backend Decimal), but W1 is a UX regression for existing users and W2 is a drift from the project's accounting conventions.
