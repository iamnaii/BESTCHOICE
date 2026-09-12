# Natural document spacing — 11 September 2026

The owner clarified that filling A4 is optional when the resulting gaps look awkward. This revision supersedes the automatic space distribution in the earlier document-spacing review.

## Change

- Remove the shared routine that enlarged section margins to reach the bottom of A4. Content and closing groups now follow the normal document flow; unused paper may remain blank.
- Keep readable short-form spacing when it fits: 1.35 line height, 2 mm table-cell padding and 16 mm signing slots. Long forms retain their compact fallback. No font is shrunk to force a page count.
- Keep TH Sarabun PSK at 16 pt body / 18 pt headings / 12 pt footer, with 18 mm top/bottom and 15 mm side paper margins.
- Client collection letters no longer anchor the closing near the bottom. The closing statement and signature still reserve space together.
- Tax invoices no longer force a 72 pt item row or a summary at 625 pt. The summary follows the item table with a 12 pt gap. Restore the intended muted green subtitle color.
- Keep print cleanup, repeated-print stability and the existing total/signature grouping. No legal wording, tax fields, calculations or permissions changed.

## Verification

- Read-only reviewer: PASS; no Critical/Warning findings across all four source files.
- Targeted mocked API tests: 4 suites / 37 tests passed with deliberately unreachable database URLs.
- Isolated PostgreSQL harness: 11 suites / 145 tests passed; no inherited application database used.
- Rendered checks: 21 short forms remain one page; original/copy/certificate counts and one payroll slip per employee remain correct. The report with twenty follow-up contracts remains two pages.
- Long notes, long Thai addresses, letter page-boundary cases, 24 distinct daily categories/accounts and tax-invoice continuation pages were checked. Closing amounts/statements remain with their signatures.
- Browser printing restores inline styles/classes and produces identical text geometry when repeated. Financial display values and FINANCE withholding-certificate issuer identity remain present.
- The owner-facing PDF contains 20 bookmarked examples / 24 pages. All final pages were rendered and visually inspected, with larger views of both termination letters, the tax invoice and both 50 bis certificates.

## Reproduce

```sh
TS_NODE_PROJECT=apps/api/tsconfig.json node -r ts-node/register/transpile-only docs/review/2026-09-11-document-natural/render-specimens.cjs
node docs/review/2026-09-11-document-natural/browser-specimens.mjs
node docs/review/2026-09-11-document-natural/preview-check.mjs
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-natural/inspect-pdfs.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-natural/check-layout.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-natural/assemble-samples.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-natural/render-final.py
```

Python rendering requires PyMuPDF/Pillow. All examples use synthetic data. The local preview uses private local file storage; staging and a physical printer were unavailable. This revision changes layout only and has not been deployed.

Final `LOCAL_PREVIEW_PORT=5207 npm run local:check` passed: API/Web type checks and lint (existing warnings, zero errors), Web 279 files / 1,979 tests, Shared 5 files / 77 tests, Storefront 7 files / 31 tests, builds and browser smoke at 1440/390 px. `local-check.json` records the exact checked source fingerprint.

`spacing-comparison.json` records representative body-end positions before/after: annual 50 bis moves from 269.0 mm to 188.6 mm, dividend 50 bis from 269.0 mm to 154.2 mm, the tax invoice from 252.9 mm to 207.7 mm, and the client termination letter from 270.7 mm to 240.5 mm. These are evidence of natural content flow, not target heights for other documents.

Final rendered audit: 58 PDFs / 116 pages, with no blank text pages, font fallback or page-bound warnings.

Fresh-backend checks also passed (`preview/check.json`): actual local contract/PDPA PDF generation and hash verification, authenticated downloads and attachment upload/view at both widths. The verified preview remains running at http://localhost:5207/contracts/9e8babd3-c27e-4ece-b451-10fcb242706a with the checked source fingerprint.
