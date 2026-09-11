# Document access and preview consistency — 11 September 2026

The owner asked to continue the document work. This follow-up completes shared PDF access and feedback across accounting previews, receipts, credit notes, trade-in vouchers, the active e-Tax page and Collections Report export. The accepted natural A4 layouts, fonts, financial values and signature grouping are unchanged.

## Findings and changes

- The receipt download function was duplicated in the receipt list, payment history, contract schedule and repossession credit notes. It had no pending state, used the default 15-second API timeout and revoked the download URL immediately. A reproduction against commit `acb0436b6` produces two requests from two immediate clicks and saves both responses after a company change (`baseline.json`).
- `DocumentDownloadButton` shares authenticated binary transport, shows a busy state, blocks repeated clicks on the button and aborts when its document leaves the page. Blob URLs remain alive long enough for the browser to consume the download. The existing per-page access and status gates remain in place.
- Expense, other-income and asset print actions now open an in-page PDF preview with loading, Thai errors, retry, print and download. This avoids opening a popup after the asynchronous response. Trade-in vouchers reuse the same preview while retaining the server filename. Preview and download use the same response bytes, without rebuilding the PDF in the browser.
- Preview requests are cancelled on close. Late responses cannot reopen a closed preview; cached blobs and object URLs are released. Print waits for iframe load. The close control is 44 px and labelled in Thai, and closing returns keyboard focus to the original button when it remains on the page.
- The actual `/finance/e-tax` route used a direct `/api/e-tax/...` PDF link that omitted the in-memory bearer token and the configured API base. It now uses the shared authenticated downloader and retains the existing ACCEPTED gate. The unused legacy `ETaxInvoicePage` was left unchanged.
- Collections Report keeps its POST route, filename convention and selected dates. Cancellation aborts the request; closing/reopening cannot cause an obsolete completion to download or close the new dialog. Request failures can be retried.
- Shared transport uses a 120-second generation timeout, checks the company revision (including away-and-back changes), accepts abort signals, and decodes bounded JSON error blobs into Thai messages. It does not forward API credentials to arbitrary storage links.

## Verification

- Read-only code review: PASS, no Critical/Warning findings, including the final focus and active e-Tax changes.
- Focused tests: five files / fourteen tests passed. Covered immediate double clicks, exact blob identity, company changes, abort despite a late transport response, PDF error/retry, iframe readiness, URL/query cleanup, report cancellation/reopen and binary JSON errors.
- Browser: actual React pages at 1440 and 390 px with intercepted synthetic API fixtures. Receipt download/error/retry, all three accounting preview integrations, close while loading, Escape/return focus, 44 px close target, active e-Tax authenticated download and report cancellation/reopen passed. Download bytes and filenames match the fixtures. All PDF requests carried the synthetic bearer token and work/company scope. No page exceptions occurred.
- The first report assertion counted an unrelated Customer 360 dialog in the same page; the harness now targets the named report dialog and passes. Earlier test type/mock errors were corrected before the final check.

## Scope and reproduction

```sh
npm run test --workspace=apps/web -- --run src/components/DocumentDownloadButton.test.tsx src/components/PdfPreview.test.tsx src/lib/document-download.test.ts src/pages/TradeInPage/components/VoucherPdfPreview.test.tsx src/pages/CollectionsPage/hooks/usePdfExport.test.tsx
node docs/review/2026-09-11-document-access/browser-check.mjs
LOCAL_PREVIEW_PORT=5207 npm run local:check
node docs/review/2026-09-11-document-access/preview-check.mjs
```

The browser fixture uses `.tmp/document-handoff/goods-3.pdf` from the preceding goods-receipt QA harness. These are transport/UI checks; they do not revalidate accounting calculations or the legal content of every PDF. Native PDF plugin pixels are blank in headless Chromium, so actual download bytes and iframe readiness are checked separately. There is no physical-printer or production-storage verification. No backend code, database schema, financial mutation, external message or deployment is part of this change.

The managed preview supports the contract/PDPA and trade-in flows documented in `docs/guides/local-check.md`; the accounting and Collections scenarios above use the separate synthetic interception harness. A link to the managed preview does not claim that it serves the full production backend for these modules.

The first managed `local:check` passed types, lint, Web 284 files / 2,003 tests, Shared 5 / 77, Storefront 7 / 31 and production builds, then stopped because the trade-in browser harness still looked for the old English `Close` button. Only its two PDF-preview selectors were updated to `ปิดตัวอย่าง`; the detail-modal selector remains unchanged. The read-only reviewer also approved this final two-line change.

Final verification: `LOCAL_PREVIEW_PORT=5207 npm run local:check` PASS on the source fingerprint recorded in `local-check.json`. Types/lint, Web 284 files / 2,003 tests, Shared 5 / 77, Storefront 7 / 31, production builds and the managed desktop/mobile browser flow passed. Existing lint and bundle-size warnings remain; no errors. The updated trade-in preview was exercised through the actual local trade-in-to-stock flow.

Fresh-backend verification also passed (`preview/check.json`): contract/PDPA generation, PDF headers/page parsing, stored-byte SHA-256 checks, authenticated downloads and attachment upload/view at both widths. No external recipient was contacted. The verified local preview remains at http://localhost:5207/inbox, with its supported document flow at the contract URL recorded in `preview/check.json`.
