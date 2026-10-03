# Daily summaries, status filters and repair dialogs — 2026-10-03

Continues the [settings/period simplification](2026-10-03-settings-period-simplification.md). Implements the three follow-up items authorized by the user. Changes are frontend-only; financial calculations, API endpoints and permissions are unchanged.

## Changes

- `DailySheetSummaryTable` renders both account and payment-channel summaries in `OtherIncomeDailySheetPage`. It retains headings, row order, empty states, styling and two-decimal amounts, including zero and negative values. The document table, CSV generation and print flow remain in the page.
- `StatusFilterTabs` replaces identical filter buttons in `OnlineOrdersPage`, `InstallmentApplicationsPage` and `SavingPlansAdminPage`. Status definitions, query keys, requests and actions remain page-owned. `ALL` still omits the status parameter; the shared component only renders buttons and passes selected values back.
- `TicketReasonDialog` shares the form and mutation for repair cancellation/send-back. Two existing public wrappers remain, with a fixed action configuration preserving each title, label, placeholder, button style, endpoint and toast. Five-character validation, untrimmed payloads, pending state, error/retry behavior and success→close callback order are unchanged. The parent still refreshes ticket/list queries.

The six original files plus the three extracted components decrease from **1,505 to 1,417 production lines**, a net reduction of **88 lines**, excluding tests. Baseline: `.tmp/tables-filters-repair-before.json`.

## Verification

- **13 new behavioral tests passed against the original code before extraction.** They exercise the real pages/dialogs: independent summary rows/empty states; status requests and selection; minimum reason length; exact endpoint/body; disabled pending submission; failed-save retry; dismissal without writes; callback order; destructive cancellation style.
- **15 focused tests passed** after extraction, including the existing online-order confirmation/refund cases. Type checking identified the project's Button default as `primary`; send-back now passes `undefined`, preserving the original omitted variant.
- Independent read-only review of the exact baseline and new modules found no blockers. `git diff --check` passed.
- Chromium coverage checks every status filter across the three admin lists, including cached return to `ALL`; daily summaries with satang/zero/negative values, independent empty states, CSV bytes and print visibility/PDF generation; and both repair actions through the full detail page, including dismiss, invalid reason, failed save/retry, dialog closure, refetch and updated timeline.
- Browser records and writes use intercepted synthetic fixtures on the isolated managed preview. Repair routing uses the existing 404 lookup fallback for a legacy ticket without a linked after-sales case. No actual repair tickets, settings or financial records are mutated. These checks do not validate backend accounting or external messaging.

**Final `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS**, completed 2026-10-03 at 21:37 Asia/Bangkok. API/Web types, lint, builds and managed desktop/mobile browser checks passed. Full suites: **2,773 admin-web tests (373 files), 128 shared tests (11 files), 32 storefront tests (7 files): 2,933 total**. API regression suites were not rerun or counted because this round changes frontend presentation only. Existing lint/bundle warnings remain without blocking errors.

After the managed backend refresh, the feature browser check passed for all three filter pages, daily summaries and both repair actions, with no page errors. Visual inspection confirmed table and dialog layouts. `npm run local:status` reports running/current, and `git diff --check` passes. Source fingerprint: `931c1598d6bf392babf3ecf80e943ef1805f9a66aca44ca78a12e0ac62bcdd1e`. The verified local preview remains running; no deployment was performed.

## Local evidence

- Preview: <http://localhost:5207/inbox>.
- Baseline/focused tests: `.tmp/tables-filters-repair-before-tests.log`, `.tmp/tables-filters-repair-tests.log`.
- Browser script/log/artifacts: `.tmp/check-tables-filters-repair.mjs`, `.tmp/tables-filters-repair-browser.log`, `.tmp/tables-filters-repair/`.
- Full result/log: `.tmp/local-preview/check.json`, `.tmp/local-preview/checks.log`, `.tmp/tables-filters-repair-local-check.log`.
