# A4 spacing correction — 11 September 2026

The owner reported that the redesigned documents clustered at the top with too much unused space below. The previous compact typography profile was used even for short forms.

## Change

- Transaction paper now uses 18 mm top/bottom and 15 mm sides. Normal short forms distribute their content to about 270 mm from the top, retaining approximately 27 mm below.
- A shared browser print routine measures each actual A4 form. When it fits, line spacing increases to 1.5 (the contract baseline), rows get more padding and signing slots get 20 mm. Font face and sizes remain unchanged: TH Sarabun PSK 16/18/12 pt.
- Remaining space is distributed between sections with a smaller gap after the header and more signing space. The routine measures nested/collapsing margins instead of assuming they add linearly. It applies no fixed height or clipping.
- Long forms fall back to compact spacing and normal page flow. Closing amount/statement remains grouped with signatures. Print styles and handlers are restored after printing, repeated printing and React unmount.
- API HTML and native browser print use the same routine. Client letters use per-document spacing with a compact fallback, and place the closing/signature block toward the lower part of A4.
- Tax invoices have a roomier header, parties and item area. Their lower summary anchor is used only on single-page invoices; continuation pages follow the items.
- Collections places the overview before follow-up contracts. The 20-row sample fits two pages; table padding was tuned to avoid an isolated twentieth row.

UX guidance came from the existing ui-ux-pro-max skill: readable line spacing and content-driven height. Paper geometry uses actual Chromium/jsPDF measurements, not the skill's unrelated mobile touch-spacing result. No legal text, financial calculations, document permissions or stored business data changed.

## Verification

- Read-only review: PASS, no outstanding Critical/Warning findings. The e-tax continuation anchoring finding was corrected.
- Targeted API tests: 5 suites / 46 tests passed, with deliberately unreachable DB URLs for mocked suites.
- Isolated PostgreSQL harness: 11 suites / 145 tests passed. No inherited application DB was used.
- Rendered layout assertions: 21 short forms remain one page; original/copy/certificate counts and one payroll slip per employee remain correct. Twenty follow-up contracts fit two report pages.
- Long notes, 24 distinct daily categories/accounts, long Thai addresses, letter page-boundary cases and multi-page tax invoices were rendered.
- Browser QA verifies before/after inline styles, cleanup of the relaxed-spacing class and identical text geometry on repeated printing.
- Short-form vertical occupancy is checked against actual PDF text bounds. Body text, amounts, signatures and all data remain present.
- The owner-facing PDF contains 20 bookmarked examples / 24 pages. Every final page is rendered for visual inspection.

## Reproduce

```sh
TS_NODE_PROJECT=apps/api/tsconfig.json node -r ts-node/register/transpile-only docs/review/2026-09-11-document-spacing/render-specimens.cjs
node docs/review/2026-09-11-document-spacing/browser-specimens.mjs
node docs/review/2026-09-11-document-spacing/preview-check.mjs
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-spacing/inspect-pdfs.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-spacing/check-layout.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-spacing/assemble-samples.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-spacing/render-final.py
```

All specimens use synthetic data. Python QA requires PyMuPDF/Pillow. The local preview uses private local storage; no staging or physical printer was available. This is a layout correction, not a production deployment or a change to form content.

Final rendered audit: **58 PDFs / 116 pages**, no blank text pages, no font fallback and no page-bound warnings. All 24 owner-facing sample pages were visually inspected.

Final `LOCAL_PREVIEW_PORT=5207 npm run local:check` passed on the fingerprint in `local-check.json`: API/Web types and lint, Web 279 files / 1,979 tests, Shared 5 files / 77 tests, Storefront 7 files / 31 tests, builds and browser smoke at 1440/390 px. The earlier check was intentionally stopped after rendered QA found the orphan report row; this final check covers the corrected source. A second read-only review passed after the padding adjustment.

`vertical-comparison.json` records actual body bounds before/after: annual WHT ends at 269.0 mm instead of 160.3 mm, dividend WHT at 269.0 mm instead of 131.7 mm, payroll at 261.1 mm instead of 212.4 mm. This is achieved with whitespace and line spacing, not smaller type.

Fresh-backend checks also passed (`preview/check.json`): real local contract/PDPA PDF generation and hash verification, authenticated downloads, attachment upload/view at both widths. The running preview matches the final source fingerprint and remains available at http://localhost:5207/contracts/9e8babd3-c27e-4ece-b451-10fcb242706a.
