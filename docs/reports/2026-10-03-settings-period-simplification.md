# Settings and monthly report controls — 2026-10-03

Continues the [journal, expense and Inbox refactor](2026-10-03-journal-expense-inbox-refactor.md). This round removes identical frontend logic from seven pages. No API, database, calculation or permission changes.

## Changes

- `SettingsPage/hooks/useSettingsEditor.ts` owns the existing settings query, edit-state snapshot and save mutation shared by `GeneralSettingsPage`, `StickersPage` and `CompanyTab`. Refetches leave an active draft alone; cancel restores the latest server values; failed saves keep the draft; successful saves invalidate the settings query and close editing. Company signature drafts remain local to `CompanyTab`, which still appends the two signature fields to its save payload. Sticker editing remains owner-only.
- `finance/components/MonthlyPeriodSelect.tsx` replaces the identical month/year controls in WHT, SSO, e-Tax and VAT Auto Journal. It preserves the moving four-year range, Buddhist-year display, Gregorian values, twelve months, widths and markup. Each page retains its existing state, query keys, endpoints and financial actions. e-Tax still waits for an explicit company choice before loading invoices.

Production source for these seven pages plus the two extracted modules decreases from **1,142 to 1,023 lines**, a net reduction of **119 lines**, excluding the new tests. Exact starting sources are in `.tmp/settings-period-before.json`.

## Verification

- Ten new tests exercise the actual three settings pages. They passed against the original implementations and after extraction. They cover draft preservation across refetch, cancel, section-only save payloads, signature preservation, query refresh, failure/retry and owner-only sticker editing.
- Focused regression: **20 tests passed** across settings editing, product/finance settings routing and e-Tax submission pagination.
- Independent read-only review against the exact seven-file baseline found no blockers; query/mutation ordering, permissions, signatures and period values are preserved.
- Chromium checks exercise all seven full pages. For each financial report they inspect the four-year options, switch year/month and verify the exact Gregorian request parameters; e-Tax company gating and company ID are checked. For each settings page they edit/cancel, reject a save, retry successfully and inspect the exact payload and refreshed display. The company flow additionally changes the signer name while preserving the signature image. No page errors.
- Browser API records and settings writes are intercepted with synthetic fixtures on the isolated managed preview. These checks do not change real settings, send messages, submit taxes or validate backend financial calculations. Layouts were visually inspected.

**Final `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS**, completed 2026-10-03 at 18:53 Asia/Bangkok. API/Web types, lint, builds and managed desktop/mobile browser checks passed. Full suites: **2,760 admin-web tests (370 files), 128 shared tests (11 files), 32 storefront tests (7 files): 2,920 total**. API regression suites were not rerun or included in this round's total because production changes are confined to frontend code. Existing lint/bundle warnings remain without blocking errors.

After the managed backend refresh, the seven-page feature browser check passed again. `git diff --check` passed, and `npm run local:status` reported running/current. Source fingerprint: `f776fc8091663fcb15889f7352ec9d6c3da79271d630fb5548789379eed4cf7e`. The preview remains running; no deployment was performed.

## Local evidence

- Preview: <http://localhost:5207/inbox>.
- Before/after focused tests: `.tmp/settings-period-before-tests.log`, `.tmp/settings-period-tests.log`.
- Browser script/log/screenshots: `.tmp/check-settings-period.mjs`, `.tmp/settings-period-browser.log`, `.tmp/settings-period/`.
- Whole-project result/log: `.tmp/local-preview/check.json`, `.tmp/local-preview/checks.log`, `.tmp/settings-period-local-check.log`.
