# Sales follow-up verification

Owner authorized implementation and confirmed there is no staging environment; this remains local testing. No real provider messages/OTP sent, no production data read or changed, no deployment.

## Scope and definitions

- Booking receipt split derives only when deposit/date/method, converted timestamp and sale amounts agree. Unknown legacy totals remain unknown. Existing journal postings remain unchanged.
- `SaleCostSnapshot` captures main-device cost for completed cash/external-finance/booking sales and contract activation (including the existing legacy draft Sale). The nullable one-to-one relation deliberately leaves old sales unknown. Online sales use the existing SaleWriter path. Exchange contracts continue not to create a new sale.
- Margin = net sale minus recorded main-device cost, only for known snapshots. Excludes bundle cost/fees/finance income; not ledger profit. Owner-only read projection; ordinary writes/detail callers cannot leak cost through automatic scalar fields.
- Export endpoints reuse list filters and actor projection in a read-only Repeatable Read transaction with a database timestamp. Excel formatting happens in browser after the transaction ends. Maximum 10,000 rows; the customer limit applies to candidates matching search/status/branch before tier or score calculation; over limit returns an explicit Thai error and no partial file. Company-change guard remains active through actual download.
- Oversized exports are rejected by a transaction-scoped count before loading rows or history. Customer tier history receives the same transaction and timestamp, calculated once for a filtered export.

## Verification

- Read-only review: initial findings fixed (nullable deposit evidence, strict-mode read on transaction client, capacity check before enrichment, export audit and Decimal margin). Final application-code review: 0 Critical / 0 Warning.
- `./tools/check-types.sh all`: API and web pass.
- Targeted API: 11 suites / 161 tests pass (`.tmp/sales-audit/followup-api.log`).
- Targeted web: 5 files / 36 tests pass (`.tmp/sales-audit/followup-web.log`).
- Storage/document adapter tests: 2 suites / 32 tests pass, SDK/Puppeteer mocked (`.tmp/sales-audit/followup-provider-adapters.log`).
- Disposable PostgreSQL: 10 suites / 126 tests pass (`.tmp/sales-audit/followup-db.log`), including real journals for mixed booking receipts, full prepayment, activation cost persistence, source-cost changes, owner projection, export audit, repeatable reads under same-count updates and read-only enforcement. First attempt found two new-test TypeScript errors; corrected and rerun successfully.
- Synthetic export benchmark: 10,000 customers + 10,000 contracts + 10,000 payments; final run 3,601 ms, JSON payload 4,488,948 bytes. One tier pass, one database connection, real PII configuration service on the transaction client. Measures local server response only, not production concurrency or browser XLSX generation.
- Browser: 24 tests pass at 1440px and 390px (`.tmp/sales-audit/followup-browser.log`), actual XLSX row counts, filters, company-change rejection, Thai 503 recovery, mixed/prepaid/unknown receipts and booking deep links. API responses intercepted with synthetic fixtures. New six receipt screenshots in `remediation-evidence/sales-booking-{mixed,prepaid,legacy}-{1440,390}.png`; mixed mobile screenshot visually inspected.
- After improving warning-text contrast, all six receipt browser cases passed again (`.tmp/sales-audit/followup-receipt-browser.log`).
- Full web run initially found two stale Excel export mocks. Updated their endpoint/response and verified all 10 void/export component tests pass. Second managed run exposed a pre-existing geometry-check race in trade-in preview. Reproduced print button height 42.0469px with entering scale 0.967274 versus 44px after animation. The helper now awaits animation completion before measuring; its original 44px assertion remains unchanged. Read-only review of this helper and the preview additions also passed.
- Final `LOCAL_PREVIEW_PORT=5207 npm run local:check`: **PASS**, all 21 checks, finished `2026-09-11T06:30:37.274Z`. Includes API/web types and lint, web/shared/storefront builds as applicable, 1,972 web tests, 77 shared tests, 31 storefront tests and desktop/mobile preview checks. Evidence: `.tmp/local-preview/check.json` and `.tmp/local-preview/checks.log`.
- Verified source fingerprint: `e56534705050a29b738ca04f418b30cca940d3e95f090ff8aefc12675b79bbc7`. Runtime/check revision is the pre-commit parent `f5ecb77d4`; the fingerprint verifies the implemented working-tree source, including API/schema/tool changes. Documentation and committing this source do not change that fingerprint.

## Manual local preview

The isolated preview now seeds one real booking receipt using the real deposit/conversion/journal services (cash1,000 + bank9,000, recorded cost6,000). Runtime metadata includes `saleUrl` and `bookingUrl`; sales, bookings and export reads use real query services against that disposable database. Local preview remains a subset of the app: the new booking sample is converted/readable, while unsupported write routes stay unsupported. UI flags use the real settings defaults so export controls can be tested.

`node docs/review/2026-09-11-sales/followup-preview-check.mjs`: **PASS** at 1440px and 390px, without API response interception. Checked the actual receipt, booking link, all three export endpoints, downloaded sales XLSX contents and absence of uncaught browser errors. Real preview screenshots were visually inspected at both widths. Evidence: [check.json](followup-preview/check.json), [desktop](followup-preview/receipt-1440.png), [mobile](followup-preview/receipt-390.png).

- [Sample sale: deposit 1,000 + additional transfer 9,000](http://localhost:5207/sales?saleId=8152b5a6-2ace-46e0-b0c9-b974cfbf0264)
- [Related booking](http://localhost:5207/bookings?bookingId=b9c46956-fb7c-4204-af03-9403488f931c)

These URLs belong to the current disposable preview and may change after a fresh database is seeded. Preview routes use the existing synthetic authentication layer and bypass production export audit; production actor scope and audit behavior are verified by the separate API/PostgreSQL tests.

## Legacy and integration boundary

`legacy-sales-audit.sql` is a read-only, repeatable diagnostic report. It identifies missing evidence; it does not infer or backfill receipts/costs. Run only in the intended test environment after migration. Any future historical correction must cite the original journal/receipt evidence and be a separate reviewed change.

Local coverage can verify document request/download/render error states and storage adapter contracts using synthetic fixtures. It cannot verify a real provider's credentials, delivery, permissions or file persistence. When a staging environment exists, exercise upload → private retrieval → expiry/denial; document generation → preview → signature consent invalidation → PDF download, using test customer data. Real OTP delivery needs explicit permission and a designated test number. No staging/provider readiness is claimed by this work.
