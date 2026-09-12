# Document print and download handoff - 11 September 2026

The owner asked to continue after accepting natural A4 spacing. A bounded audit of document entry points found remaining work in goods receipts and letter printing. The accepted receipt, contract and tax layouts remain the baseline.

## Changes

- Goods receipt uses the shared transaction header, green table, TH Sarabun PSK type, and natural A4 spacing. The inspection counts, both signatures and footer stay together. The IMEI column accommodates all 15 digits; notes and rejection details remain present. Printing is unavailable during loading, refresh or error.
- Letter PDF read and mark routes resolve the actual letter's contract before rendering or mutation. Branch-limited actors cannot bypass this with a known foreign letter ID or an own-branch query parameter. Missing/deleted letters and deleted contracts are excluded; cross-branch roles retain access.
- Marking is conditional on the pending state so a late confirmation cannot revive a cancelled letter. A confirmation with no replacement URL is idempotent after success, including concurrent requests or a lost response; no extra audit is added.
- Bulk PDFs, titles and confirmations use a frozen selection. Closing the dialog aborts its requests and releases its blob URL. Obsolete results and callbacks cannot affect a later dialog/company scope.
- Downloading does not mark a document printed. The user confirms after printing. Failed confirmations remain available for retry; successful ones are removed from the retry set. Duplicate submissions are blocked.
- Stored public PDF URLs retain their original bytes for reprinting. Browser reads omit credentials and referrers; staff API tokens are never sent to storage origins and the server does not proxy client-controlled URLs. Archive failures show a Thai recovery message and never silently regenerate content. Cross-origin read restrictions may require opening the original individually.
- Rows without a stored original explicitly say that a PDF will be generated from current data/date. Single preview and dispatch download have the same notice. Existing original download links are preserved.
- Letter lists now paginate beyond 50 rows and return to a valid page after the last page shrinks. Error retry, accessible selection/preview names, mobile table scrolling and dialog toolbar wrapping improve the workflow. Forward actions, undo and bulk marking refresh the list, counts and collection queue.

## Verification

- Read-only reviewer: PASS, no outstanding Critical/Warning findings in this delta.
- Isolated PostgreSQL: 12 suites / 153 tests passed. Eight letter cases exercise actual HTTP guards, exact PDF transport, same/cross/branchless actors, cross-branch roles, deleted aggregates, cancelled-state races and idempotent concurrent/repeated confirmations. PDF rendering is stubbed in these permission tests; no production database or outbound transport is used.
- Focused Web: 2 files / 13 tests passed, covering actual merged page counts, original bytes, archive failure, abort/unmount, company changes, reopen, selection snapshots, partial retry, duplicate confirmation and print readiness.
- Existing letter service suite: 44 tests passed against mocks with unreachable DB URLs.
- Browser: actual React pages at 1440 and 390 px with intercepted synthetic API fixtures. Tests cover 51-row pagination, 51-to-50 last-page shrink, PDF failure/retry, two-page combined download, explicit confirmation, partial recovery, null-archive single preview and repeat generation. No page exceptions or horizontal viewport overflow.
- Rendered PDFs: eight files / thirteen pages; no blank pages, font fallback or page-bound warnings. Empty/three-item goods receipts fit one page; twenty items fit two pages. Summary and signatures remain together, and repeated printing has identical text geometry.
- The goods-receipt review artifact has two bookmarked examples / three pages. Every final page was rendered and visually inspected; IMEI wrapping found in the first render was corrected before final verification.

## Reproduce

```sh
bash tools/test-chat-credit.sh
npm run test --workspace=apps/web -- --run src/hooks/useLetterPdf.test.tsx src/pages/LettersPage/__tests__/BulkPrintDialog.test.tsx
node docs/review/2026-09-11-document-handoff/browser-check.mjs
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-handoff/inspect-pdfs.py
LOCAL_PREVIEW_PORT=5207 npm run local:check
```

The browser fixture uses the earlier synthetic termination PDF in `.tmp/document-style`; regenerate it with the natural-spacing specimen harness if needed. Python rendering requires PyMuPDF/Pillow. All sample identities are synthetic. Native PDF iframe pixels are not rendered by the headless browser; downloads are parsed independently and pages rendered for inspection. No physical printer, staging account or production storage provider was available. No deployment or external message is included. The new letter guard is limited to PDF read/mark routes; this is not a security audit of all collection mutations.

Final `LOCAL_PREVIEW_PORT=5207 npm run local:check` passed on the source fingerprint recorded in `local-check.json`: API/Web types and lint, Web/Shared/Storefront tests, production builds and browser smoke at 1440/390 px. An earlier attempt caught an unsupported Testing Library type option in a new test; this was corrected. A later successful check was repeated after the final four-line logo/tax-ID layout adjustment, which also passed read-only review and rendered QA.

Final totals: Web 281 files / 1,992 tests; Shared 5 files / 77 tests; Storefront 7 files / 31 tests. Existing lint warnings remain; no lint errors. Fresh-backend contract/PDPA generation, stored-byte hashes, authenticated downloads and attachment upload/view passed at both widths (`preview/check.json`). The managed preview remains running at http://localhost:5207/contracts/9e8babd3-c27e-4ece-b451-10fcb242706a; letter and goods-receipt UI scenarios use the separate synthetic interception harness because those full routes are outside the managed preview's supported data scope.
