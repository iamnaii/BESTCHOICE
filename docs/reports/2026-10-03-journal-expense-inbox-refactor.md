# Journal, expense and Inbox simplification — 2026-10-03

Continues the [upload client simplification](2026-10-03-upload-client-simplification.md). Implements all three authorized refactors in the local checkout. No deployment, production database changes or external messages.

## Changes

1. **Journal display:** extracted `VoucherJournalTable` for standard and petty-cash vouchers, and `AuditJournalTable` for original/modified other-income journal entries. Existing amount formatting, row order and print classes are preserved. Adjustment accounts remain visible on screen and are hidden only in print when the setting excludes them. Existing exports from `PaymentVoucherPage` remain compatible.
2. **Expense and payroll persistence:** extracted typed, pure line-data mappings used by the four create/update paths. Decimal conversion, defaults, tax-disallowed values and nested payroll income/deduction handling remain consistent. Calculations, transaction boundaries, draft guards, employee snapshots and unrelated credit-note/petty-cash mappings stay in their existing callers. No schema change.
3. **Inbox responsibilities:** extracted `useRoomNotes`, `useRoomActions` and `useRoomMessages`. The page retains socket integration, navigation and UI composition. The hooks own their queries, mutations, pending/failed sends, file uploads and retry handling.

Inbox regression coverage also supports three deliberate corrections found during extraction: delayed assignment/transfer/upload completion refreshes the originating room; a WebSocket-first failure retains the later HTTP retry token; and retry network calls run outside React state updaters, preventing duplicate side effects under StrictMode.

| Main file | Before | After |
| --- | ---: | ---: |
| PaymentVoucherPage.tsx | 1,083 | 995 |
| OtherIncomeViewPage.tsx | 939 | 900 |
| expense-document-create.service.ts | 1,270 | 1,219 |
| UnifiedInboxPage/index.tsx | 759 | 478 |

These are main-file line counts, not net repository deletions: extracted modules and behavioral tests are added separately. The exact starting contents are retained locally in `.tmp/refactor-three-before/sources.json`.

## Verification

- Focused web tests: **25 passed** across four files, including the new hooks/tables and existing withholding-tax cases. Tests cover missing data, satang precision, print-only adjustment visibility, room switching during pending requests, original retry tokens, file-token reuse, note operations, assignment/transfer, next-room selection, undo and distinct AI endpoints.
- API regression: **612 passed**, with **3 existing skipped tests**, across the expense-documents and other-income suites. The skipped cases are two pagination-performance cases and the existing reverse-closed-period case.
- Real PostgreSQL payroll integration: **14 passed**, including create/update with custom income and deductions containing satang, exact net pay and empty nested lists. The harness creates disposable SHOP/FINANCE databases and does not use inherited application databases.
- Independent read-only review of the exact four-file baseline, new helpers/hooks and tests found no blockers.
- Document browser checks exercise the full voucher pages for expense/petty-cash documents with both adjustment settings, actual print CSS and four generated Chromium PDFs. The full other-income page renders independent original/modified audit amounts correctly. No page errors. API records are synthetic; these checks do not post accounting transactions or assert PDF page count.
- Inbox browser checks exercise send failure/retry with the same token and a single saved message; note add/pin/unpin/delete; assignment/transfer; AI release/return/undo; and resolve/reopen undo. Mutations are intercepted with synthetic state. No page errors or external messages.

**Final `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS**, completed 2026-10-03 at 18:25 Asia/Bangkok. API/Web types, lint, builds and managed desktop/mobile browser checks passed. Full suites: **2,750 admin-web tests (369 files), 128 shared tests (11 files), 32 storefront tests (7 files)**. Combined with the 626 API tests above, **3,536 tests passed** in this round; the 3 pre-existing API skips remain. Existing lint/bundle warnings remain without blocking errors.

The managed backend was refreshed from this checkout, then both feature browser scripts passed again. The Inbox script now scopes the final undo action to the close-chat notification, avoiding a race with an earlier AI notification. Visual inspection confirmed the voucher print layouts and Inbox rendering. `git diff --check` passed. `npm run local:status` reported running/current with source fingerprint `cc31f398518aefaafa5b4ca81e7de349bf005a0731580d12ceec5e94035f11dd`.

## Local evidence

- Preview: <http://localhost:5207/inbox> (managed synthetic backend, limited feature scope).
- Whole-project result/log: `.tmp/local-preview/check.json`, `.tmp/local-preview/checks.log`, `.tmp/three-local-check.log`.
- Focused web/API logs: `.tmp/three-web-focused.log`, `.tmp/three-inbox-tests.log`, `.tmp/three-api.log`.
- Feature browser scripts/logs: `.tmp/check-three-docs.mjs`, `.tmp/three-docs-browser.log`, `.tmp/check-three-inbox.mjs`, `.tmp/three-inbox-browser.log`.
- Screenshots and four voucher PDFs: `.tmp/three-docs/`; audit screenshot `audit-comparison.png`; Inbox screenshot `inbox-actions.png`.
