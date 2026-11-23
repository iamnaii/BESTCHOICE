# Stock inventory scope — verification, 22 November 2026

Implemented the approved devices/accessories/all stock overview and original-date imported sales analytics. Devices are the overview default; existing API and direct product-list callers retain all-category defaults. QC and completed ages over 90 days have matching drilldowns; grouped accessory rows expose physical-unit counts.

Sales combine completed native sale occurrences and proven Tooltify rows, using Bangkok sale months. Repeated IMEIs are not deduplicated. Gifts remain separate from revenue. Native rankings respect independent current-product permissions. Legacy source roles/home branches and managed permission scopes are both enforced; absent authorization fails closed for sales analytics. Optional warranty failures do not hide authorized inventory results.

Verification completed on the exact working-tree source fingerprint below before committing:

- `npm run local:check`: PASS, including type checks, API/Web lint, 5,229 Web tests, 324 shared tests, 108 storefront tests, both frontend builds and full owned-preview browser workflow.
- Real disposable PostgreSQL: 11 stock scope/sales tests; 36 persisted-access HTTP tests; 26 focused API regressions.
- Stock browser acceptance at 1440px and 375px: keyboard selection, Back/Forward/reload, source dialog, exact QC/aging destination unit totals, optional-section 503/retry and no product mutation requests.
- Manual Chrome: devices default, source totals, and imported-history table with repeated IMEI rows and a gift.
- Fresh independent review findings were fixed: legacy source grants, independent product-name projection, completed-sale filter, shared URL updater, section-level failure handling, partial cost projection, previous-month caption, context-preserving navigation and Bangkok intake boundary.

Preview: http://localhost:5297/stock?zone=shop

The preview uses synthetic data and real read services from this checkout. It is not a fresh reconciliation of production balances. The intake graph represents records created in BESTCHOICE, including migration intake. History links explicitly open all history within the user's permissions; filters are selected on those destination pages. No production data writes, merge, push or deployment were performed.

Source fingerprint: `ddc8cb4074fc0b4d271c53149b01fa297477291a07667e78e30c81139d8b9624`

Final report: `.tmp/local-preview/check.json` (44 checks, finished 2026-11-22T13:59:21.918Z).
