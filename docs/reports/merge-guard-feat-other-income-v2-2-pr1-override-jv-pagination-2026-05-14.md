# Merge Guard Report — feat/other-income-v2-2-pr1-override-jv-pagination

**Date**: 2026-05-14  
**Branch**: `feat/other-income-v2-2-pr1-override-jv-pagination`  
**Author**: Akenarin Kongdach  
**Last Commit**: 2026-05-13 17:47 +07:00  
**Commits Ahead of main**: 64  

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 56 |
| Insertions | +5,924 |
| Deletions | -478 |
| New files | 20 (excl. docs/html) |
| Migrations added | 3 |

**Key areas touched**:
- `other-income.controller.ts` — 2 new endpoints (maker-checker toggle, pending-ready-count)
- `other-income.service.ts` (1,249 lines) — override JE logic, reopen-period support
- New service: `journal-override.service.ts` — V1/V2/V5 override validation
- New service: `JournalOverrideService` — diff summary for audit log
- Frontend: `SettingsPage` refactored into 5-tab structure (Company/VAT/Periods/Attachment/Users)
- Frontend: `EditableJournalTable.tsx` + `OverrideConfirmDialog.tsx` — override JV UI
- Frontend: `PaginationBar.tsx` + `usePaginationParams.ts` — pagination controls
- Frontend: `ReopenedPeriodBanner.tsx` — period reopen warning banner
- Migrations: pagination indexes, reopen metadata columns, settings key seeding

---

## Issues Found

### Critical (must fix before merge)

None found.

### Warning (should fix)

**W-1**: `OverrideJournalLineDto.debit` / `.credit` typed as JS `number` instead of `string`

- **File**: `apps/api/src/modules/other-income/dto/post-other-income.dto.ts`
- **Lines**: `debit!: number` / `credit!: number` with `@IsNumber()` validator
- **Issue**: Per codebase convention, money fields must never be JS `number`. The service does correctly wrap via `new D(l.debit)`, and Decimal.js handles float-to-Decimal conversion acceptably for 2dp THB amounts in normal ranges. However, this is a convention violation and a latent risk if very large or unusual values are entered (e.g. `1234567890.10` may not parse with full precision from a float).
- **Fix**: Change to `@IsNumberString({}, { message: '...' })` + `debit!: string`, then in service keep `new D(l.debit)` (string overload is exact).

**W-2**: `EditableJournalTable` uses `number` for debit/credit state

- **File**: `apps/web/src/pages/other-income/components/EditableJournalTable.tsx:7-9`
- **Type**: `EditableJournalLine.debit: number`
- **Issue**: Front-end money state uses JS `number`. The cents-integer approach (`Math.round(x * 100)`) for balance checking is pragmatic and avoids float addition errors, but the architectural convention for this codebase is to avoid `number` for monetary values entirely. Low actual risk since the server re-validates with Decimal.
- **Fix**: Accept as `string` input from `<Input type="number">` (event value is always string), send to API as string, let server parse to Decimal.

**W-3**: `OtherIncomeViewPage` audit log parsing uses `(log.oldValue as any)` / `(log.newValue as any)`

- **File**: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`
- **Issue**: Audit log JSON values typed as `any` for JV override display. Not a security issue (display-only), but provides no type safety for the diff display. If the audit log shape changes, this will silently show nothing.
- **Fix**: Define an `AuditJvLines` interface matching the stored shape and use a type guard.

---

### Info

**I-1**: `other-income.service.ts` is 1,249 lines

This file is approaching the point where it should be split. Recommend extracting the period-reopen logic (`reopenPeriod`, `closePeriod`, `getReopenedPeriods`) into a `PeriodService` to keep the main service focused on CRUD + posting flows.

**I-2**: `apps/web/src/App.tsx` is 1,083 lines

Route registration grows with every PR. Consider grouping related routes into a `settingsRoutes`, `otherIncomeRoutes` array fed into `createBrowserRouter` to reduce the noise.

**I-3**: `Number(l.debit).toLocaleString(...)` in view page audit log display

- **File**: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`
- This is display-only formatting of values retrieved from an audit log JSON blob. The `Number()` call here is for `toLocaleString` formatting, not financial arithmetic. Acceptable in this display context.

---

## Positive Observations

- **Guards**: All new controller methods have `@Roles(...)` decorator; class-level `@UseGuards(JwtAuthGuard, RolesGuard)` is inherited. No unguarded endpoints.
- **JournalOverrideService**: Correctly uses `Prisma.Decimal` for all arithmetic (V1 balance check via `.plus()` / `.abs()`).
- **CAS race protection** on reopen period (`updateMany` with `status: 'CLOSED'` filter inside `$transaction`) properly prevents concurrent reopen.
- **Cache invalidation**: All new mutations call `queryClient.invalidateQueries()` with correct keys.
- **DTO validation**: `ToggleMakerCheckerDto`, `ListOtherIncomeQueryDto` (sort param regex), `ReopenPeriodDto` all have class-validator decorators with Thai messages.
- **deletedAt filter**: All new `findMany`/`findFirst` queries include `{ deletedAt: null }`.
- **No hardcoded secrets**.
- **No raw SQL / `$queryRaw`**.
- **Tests**: New specs cover `JournalOverrideService`, `PaginationBar`, `usePaginationParams`, `ReopenPeriodModal`, `OverrideConfirmDialog` — solid coverage for new components.

---

## Recommendation

**REVIEW** — No critical blockers. Two warnings related to the `number` vs `string`/`Decimal` convention for the override JE DTO and its frontend counterpart. These are low actual-risk (server re-validates with Decimal) but violate the codebase's money-handling convention and should be fixed before merge to avoid setting a bad precedent.

Suggested fix path:
1. Change `OverrideJournalLineDto.debit`/`.credit` from `number` → `string`, update validator to `@IsNumberString`.
2. Update `EditableJournalTable` to send string values to the API (can keep internal `number` state for `<input type="number">` UX, but serialize as string in the API payload).
3. Address W-3 by typing the audit log JV shape.
