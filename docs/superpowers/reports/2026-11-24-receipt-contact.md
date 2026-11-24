# Receipt contact follow-up — 2026-11-24

User requested LINE and telephone contact information, specifying 0955678887.

- Added LINE @BESTCHOICE with https://line.me/R/ti/p/@bestchoice, matching `apps/web-shop/src/lib/copy.ts` and the existing public stock copy.
- Printed 095-567-8887 in the header and contact block; the footer uses a tel:0955678887 link.
- Kept the branch label and the existing receipt QR. Company profile data and QR destination are unchanged.
- Receipt tests: 25/25 unit tests plus 1/1 dedicated documents-layout test pass, including real Puppeteer one-page A4 PDFs for used, new/external-finance, and voided fixtures, retaining 16 pt typography.
- Independently parsed final sample PDFs: one page each; actual PDF annotations include the correct LINE and telephone URI.
- Poppler-rendered used/new pages visually checked: contacts, six used-device warranty clauses, QR, footer and signature remain readable with no clipping or overlap.
- Read-only reviewer found no correctness concerns.

Final synthetic sample files: `.tmp/receipt-contact/output/pdf/receipt-used-contact-a4.pdf` and `receipt-new-contact-a4.pdf`. These supersede earlier receipt samples. Logs and rendered pages: `.tmp/receipt-contact/`.

No production writes or deployment. Managed preview: http://localhost:5218/products/create (synthetic data/integrations). Full local check result: `.tmp/local-preview/check.json`.

CI placement: the real-browser layout test lives in `apps/api/e2e/documents/sale-receipt-layout.docs-spec.ts`, discovered by the documents job that installs Chromium. API unit tests remain browser-independent because cached node_modules does not guarantee a Puppeteer browser cache. The first local full check was intentionally interrupted for this placement correction and is superseded by the final run.

Final local check: PASS 49/49, 2026-11-24T07:28:23.470Z. Fingerprint: `20436c6b0d6c148628d367dfdec9f9df11c53f376da2e4904c122ef565bd0c5d`. Current managed preview remains running.
