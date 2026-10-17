# UX/UI follow-up — 17 October 2026

Status: confirmed application fixes verified; final release gates are tracked in [PR #1707](https://github.com/iamnaii/BESTCHOICE/pull/1707). This closes confirmed defects and expands deterministic acceptance coverage; it is **not certification that every action/state across the application has been exercised**. Work is based on `c5d26edcf` in `fix/appointment-field-consistency-20261016` and preserves the earlier form/dropdown changes.

## Confirmed fixes

- Shared icon buttons, switches, table selection labels, sheet close, LIFF back and pager targets reach 44 CSS px on narrow viewports (55 px with a 20 px root). Switch visual tracks keep their original sizes. Row selection does not accidentally open the row.
- DataTable selection columns reserve the enlarged label width; mobile pagination stays on one line. Booking More/Close controls have separate targets and headings reserve room for both.
- Reverse-reason settings use clear move-up icons, row-specific names, scrollable tables, and stacked footer content on narrow screens. GFIN, MDM and automatic receipt switches have accessible names.
- Closed Customer 360 panels are hidden from accessibility navigation. Contact logging invalidates cached promise data and waits for the latest previous-promise information before allowing save, preserving the reschedule confirmation.
- Finance receivable detail loads current KPI values, refreshes after contact logging/reopening, and offers a retry on errors instead of silently showing old data.
- Public contract verification no longer fails at BranchGuard before reaching its hash check. Only explicitly public endpoints bypass the user/branch check; protected-route and cross-branch checks remain. Unicode/repeated hash inputs fail without a 500. The page renders only the actual minimal public response, not customer/branch/payment fields that the API deliberately does not expose.
- Profile extension and default receipt-account preferences now hydrate after login/refresh. PBX loading, failure/retry and a successful empty list are distinguishable. Controls stack on mobile; saved preferences survive reload.
- Monthly close awaits PEAK configuration and refuses to mark a period synced when the exporter reports partial failures.
- The cash-close 14-day strip now keeps 44 px cells in one scroll region, opens at the selected/latest day after CSS layout is ready, preserves user scroll on refetch, and keeps branch names visible. Expense row actions, customer/product copy/edit controls, AP-aging selection and letter selection have real 44 px mobile targets. Other-income adjustment rows wrap on narrow screens without losing values; product identity stacks its image above the details on mobile.

The earlier dropdown migration remains covered by a source inventory test: raw select/datalist consumers cannot reappear outside the two shared native-select implementations. Fonts stay Noto Sans Thai Looped in UI; document fonts are preserved.

## Evidence and scope

| Suite | Result / scope |
| --- | --- |
| [Shared controls](touch-controls.json) | 10 configurations, Chromium + WebKit; 320/390/844/1440 widths, light/dark, 16/20 root px, edge click, keyboard, disabled state, table selection, sheet close/focus return |
| [Settings actions](settings-touch.json) | 6 configurations, Chromium + WebKit; real isolated API CRUD/reorder/toggle for synthetic reasons, cancel confirmations, branch edit/warehouse cancel |
| [Booking header](booking-header.json) | 6 configurations, Chromium + WebKit; actual component with one mocked detail GET, long title, separate targets, More/Escape/close. No booking payment mutation |
| [Remaining touch controls](residual-controls.json) | 6 configurations, Chromium + WebKit at 320/root 20, 390 and 1440: actual components with synthetic reads; latest-day positioning, edge click/focus, copy value, letter/AP selection, adjustment append/select/remove with retained values |
| [Remaining page actions](residual-pages.json) | 6 configurations, Chromium + WebKit: real isolated API reads; customer copy/edit-cancel, expense menu/detail, income apply-net draft without save |
| Focused formerly skipped cases | 21 passed in focused-5; later finance/reopen/public/profile run focused-7 passed 6. The broader run and focused retests are reported separately below |
| API unit tests | BranchGuard, auth and monthly close: 60 passed |
| [Full isolated E2E](full-e2e-result.json) | 828 passed, 1 failed, 0 skipped, 0 flaky. Sole failure: shared Vite optimizer cache returned `504 Outdated Optimize Dep` for `vaul.js` on `/purchase-orders`. Original failure is preserved; focused rerun after cache isolation is below |
| [Page-health cache retest](page-health-cache-retest.json) | 92 passed, 0 failed/skipped/flaky, including PO; fresh disposable API/DB, no assertion changes |
| [Mobile route inventory](mobile-summary.json) | 269 entries / 538 observations at 390 px in light/dark: no document overflow, wrong UI font or runtime root error. Ten rows have missing-token/provider API responses, retained in the summary; route visits are not action acceptance |
| [Affected-route retest](mobile-inventory-residual.json) | 8 routes ×320/390/1440 ×light/dark = 48 observations after touch-layout changes, all rendered. Cash initial-scroll timing was subsequently covered by the final two-engine gallery |
| [Pre-CI local check](local-check-final.json) | 39/39 checks passed on the cache-isolation fingerprint; 3,590 unit tests, API/Web types, zero lint errors, builds and desktop/mobile synthetic preview flows |
| [UI-source local check](local-check-ui-source.json) | 39/39 checks passed; 3,389 Web +149 Shared +52 Storefront unit tests, types, lint, builds and synthetic browser flows. Final post-cache check also passed, below |

Real PostgreSQL and AppModule are used for finance/public/auth scenarios. New fixture users, contracts, payment links, invites, periods and receivables are dedicated to this runner. Provider transports are synthetic; a signed webhook request tests application processing, **not provider certification**. Fixture manifests and credentials remain in ignored `.tmp`, not this report.

UI-source verified fingerprint (apps/packages/tools): `794b7d27bb26411dfc6dccc8310bed86ce7ab92011fee9b1ebde44c079672c66`. Test-cache isolation fingerprint: `9f41b6ceddb15fdd9ed8e27f1a3cbd2be5d32e6cc2a8852b7186e34fc1fde3a3`.

Two broader E2E attempts were intentionally interrupted: one after confirming the public-route guard defect, another before fixing confirmed small touch targets. The completed full run began before the final cash-strip positioning-only adjustment; that exact change is separately covered by the final Chromium/WebKit gallery and final frozen local check. Partial results from the two interrupted attempts are not counted as acceptance. Earlier focused failures include stale promise data, the off-screen Customer 360 panel, stale drawer KPIs, and test locators; final evidence must distinguish source fixes from test-only corrections.

### Test infrastructure correction

Concurrent audit/gallery servers previously shared `apps/web/node_modules/.vite`. The completed full run captured a stale optimized dependency request on the PO page. Each real-API harness server now receives an absolute cache path inside its own output directory, including its port; a standalone QA server falls back to a PID-specific path. This changes only `vite.docs-qa.config.ts` and the test launcher. Console/5xx assertions and production Vite configuration remain unchanged. Full and focused results are separate evidence, not one claimed clean full run.

### CI assertion correction after the initial PR

The broader CI money-invariant run found a pre-existing flaky VAT-visibility assertion: searching the whole JSON response for `686` matched `downPaymentReceivedAt` ending in `.686Z`; the actual restricted VAT fields were null. The test now checks the exact fields on contract detail/list and both PO receiving paths, includes BM and SALES, verifies nonempty arrays and owner amounts, and fixes the fixture timestamp to `.686Z` so the former collision is exercised every run. Production logic is unchanged. [Isolated retest](vat-visibility-ci-retest.json): 7/7 passed. A new local check and fresh PR CI run follow this test-only change; final release status is in PR #1707. Its source fingerprint is `ae787a241a5d52c0d60ad00733418ae81c703810913a601e49a70f3cc505eb0b`.

## Remaining limits

- The 307-entry route inventory and 4,331 source event sites are inventories, not 4,331 tested buttons. Deep MDM/provider actions, repossession/exchange variants and every role/branch combination are not all covered.
- No physical iPhone/Android/staging or live LINE/Meta/PBX/payment environment is available. Browser WebKit is not a real iPhone.
- Native Chrome test-tab zoom was read back at 100% this round. Earlier root-font 20 px checks are separately labelled and are not browser-zoom tests.
- Existing lint warnings remain technical debt: see [classification](lint-classification.json). The PEAK async correctness defect was fixed; warnings were not mass-disabled or treated as visual defects.
- The fresh mobile inventory records 337 small-control observations before the final touch fixes, including aliases, inline links and inner checkbox nodes. Five confirmed groups were fixed and tested above; the inventory is not 337 confirmed defects or 337 fixed controls.
- Baseline public invoice/token/legacy aliases/provider errors must be interpreted using [coverage disposition](coverage-disposition.md), not all labelled expected errors or successful flows.

## Local review and release

Managed preview is running at [localhost:5206](http://localhost:5206), verified against the recorded application changes. The latest local check is kept in `.tmp/local-preview/check.json` and its result is recorded in PR #1707 before merge. Its API/data/AI are synthetic and it has the limited scope documented in AGENTS.md. Other module tests use disposable PostgreSQL. Release status is tracked in the pull request and deployment workflow; local verification does not itself prove a production deployment.
