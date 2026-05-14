# Merge Guard Report — feat/other-income-v2-2-pr1-override-jv-pagination

**Date**: 2026-05-14  
**Branch**: `feat/other-income-v2-2-pr1-override-jv-pagination`  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local / akenarin.ak@gmail.com)  
**Commits ahead of main**: 65  
**Files changed**: 56 files, +5924 / -478 lines (TS/TSX only)  
**Recommendation**: ✅ APPROVE (with advisory notes)

---

## Summary

This branch adds three major features on top of `feat/other-income-v2-1-combined`:

1. **Override JV** — OWNER can manually edit a journal entry before posting (`POST /other-income/:id/post` with `{ override: true, overrideLines: [...] }`) via `JournalOverrideService` + `EditableJournalTable` UI.
2. **Pagination** — cursor-less offset pagination on the Other Income list (`ListOtherIncomeQueryDto` + `PaginationBar` component + `usePaginationParams` hook).
3. **Settings 5-tab hub** — refactors `/settings` into Company / VAT / Periods / Attachment / Users tabs with hash-sync; extracts `ReopenPeriodModal`, `ReopenedPeriodBanner`, `AttachmentTab`, `VatTab`, `CompanyTab`, `PeriodsTab`, `UsersTab`.

---

## Issues Found

### Critical — None

| Check | Result |
|-------|--------|
| New controllers missing `@UseGuards` | ✅ Not applicable — new endpoints added to existing guarded controllers |
| New endpoints missing `@Roles` | ✅ All 3 new routes have `@Roles` (`OWNER` or `OWNER,FINANCE_MANAGER,ACCOUNTANT`) |
| `Number()` on money/financial fields | ✅ None found in service layer. `JournalOverrideService` uses `Prisma.Decimal` throughout |
| Missing `deletedAt: null` in new queries | ✅ Only new queries are on `AccountingPeriod` which has no `deletedAt` field by design |
| Hardcoded secrets / API keys | ✅ None found |
| SQL injection via unparameterized `$queryRaw` | ✅ None found |

### Warning — 3 items

**W1 — `EditableJournalTable` uses `number` for Dr/Cr fields (frontend)**  
File: `apps/web/src/pages/other-income/components/EditableJournalTable.tsx`  
`EditableJournalLine.debit` and `.credit` are plain TypeScript `number`. Client-side balance check uses `Math.round((l.debit || 0) * 100)` to work around float precision. The backend correctly receives and validates these as `Prisma.Decimal`, so no data corruption risk — but UI display could show floating-point artefacts for amounts that aren't representable exactly in binary (e.g. 0.1 + 0.2 ≠ 0.3). Consider using string inputs or a display-only `Decimal` helper on the frontend.

**W2 — `other-income.service.ts` is 1258 lines**  
Exceeds the 500-line guidance significantly. Methods like `create`, `post`, `approve`, `requestApproval`, `reject`, `setMakerCheckerEnabled`, `listReopenedPeriods` could be split into sub-services (e.g. `MakerCheckerService`, `OtherIncomePostService`). Not a blocker, but growth will make the file harder to navigate.

**W3 — Loose `any` cast in audit log rendering**  
File: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`  
`(log.oldValue as any)?.jvLines` and `(log.newValue as any)?.jvLines` render JV override diffs. Consider extracting a `JvOverrideAuditValue` interface in `otherIncome.types.ts` for type safety.

### Info — 2 items

**I1 — `catch (e: any)` in tests and one UI mutation handler**  
Several new test blocks and one `onError: (err: any)` handler use `any` for caught exceptions. Standard pattern in this codebase — no action required.

**I2 — `monthly-close.service.ts` is 650 lines**  
Slightly above the 500-line soft limit. Acceptable for now; monitor as `reopenPeriod` and `closePeriod` flows continue to grow.

---

## Positive Highlights

- **TOCTOU race protection on approve()**: CAS-`updateMany` with `status: READY` filter prevents double-approval by two concurrent OWNERs — correct pattern.
- **ReopenPeriod uses CAS too**: `updateMany({ where: { status: 'CLOSED' } })` in a `$transaction` prevents concurrent reopen of the same period.
- **All new DTOs have Thai validation messages** and `class-validator` decorators.
- **`invalidateQueries` coverage**: verified per-file — every `useMutation` call in new TSX files has a corresponding `invalidateQueries` in the same file.
- **`JournalOverrideService`**: clean Decimal arithmetic with 0.01 THB tolerance, V1/V2/V5 validation, and Thai-language diff summary for audit log.
- **SettingsPage OWNER guard**: `user.role !== 'OWNER' → Navigate to "/"` correctly applied before render.
- **No hardcoded color tokens** — all new TSX uses semantic tokens (`bg-warning/10`, `text-muted-foreground`, etc.).
