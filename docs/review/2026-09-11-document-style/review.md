# System document typography and print layout

Scope authorized by the owner: all system documents. This change covers every active PDF generator and browser document-print path found in `apps/api` and `apps/web`. CSV/XLSX data exports and stored, previously issued PDF bytes are outside the paper-layout change.

## Result

- One shared baseline: TH Sarabun PSK regular/bold; 16 pt body/table, 18 pt headings, 12 pt footers; A4 margins 20 mm top/bottom and 19 mm sides.
- Existing explicitly configured template sizes remain supported. Template preview and export now interpret the same point sizes. Contract/letter prose uses 1.5 leading; compact transaction forms use 1.15 to retain usable signing space.
- Backend fonts are embedded from packaged local assets. Browser PDF export fails clearly on a missing font and permits retry. Native print waits for both regular and bold font faces.
- A4 tables repeat their headings and avoid splitting individual rows. Wide registers use landscape pages. Long addresses wrap; signature groups stay together. PDPA consent and its signatures form one group.
- Print removes application chrome, scroll clipping and dark-theme text/background conflicts. Certificate dialogs print without Tailwind transform/translate clipping. Animated amounts print their actual final value.
- Thermal stickers use the same family with their existing physical type scale and 50×30 mm page size.

## Coverage

| Family | Exercised |
| --- | --- |
| Contract and PDPA | Real local generation/download, hash comparison, stored file retrieval; template preview/export; long paragraph pagination |
| Payment receipts | PAYMENT, DOWN_PAYMENT, CREDIT_NOTE, EARLY_PAYOFF, RESCHEDULE_FEE; short and long addresses |
| Financial source documents | Other-income receipt, expense voucher, asset receipt; short and 16-row long cases |
| Trade-in | Cash purchase and trade-in credit, original/copy variants, signed declaration, short/long parties |
| Collections | Return-device and contract-termination letters through both server and browser generators |
| Tax and reporting | E-tax PDF and Thai collection report; multi-page report table |
| Browser vouchers | Standard original + copy + withholding certificate; petty cash; payroll; long item table |
| Browser registers | Goods receipt, expense daily summary, other-income daily sheet, asset register, annual withholding and dividend registers |
| Certificates and labels | Annual withholding and dividend certificate dialogs; product sticker |

## Verification

- Web regression: **279 files / 1,979 tests passed**.
- Targeted API unit suites: **5 suites / 46 tests passed** (receipt rendering, e-tax, reporting/finance tax and trade-in voucher coverage).
- Isolated PostgreSQL harness: **11 suites / 145 tests passed**. No inherited application database was used.
- API production build and asset verification passed; both packaged font files match the source bytes, and the compiled font adapter loads both faces.
- Final voucher/print helper rerun: **2 files / 9 tests passed**.
- Native browser print fixtures: 10 page variants plus two certificate dialogs and a sticker; no page errors and 16 pt computed table type. Missing-font export and retry also exercised.
- Independent read-only reviewer: **PASS, 0 Critical / 0 Warning**, including the final layout changes.
- Representative PDFs are rendered with real fonts and inspected page by page. `pdf-metrics.json` records actual page counts, embedded font names/sizes and page-bound checks; `html-metrics.json` records overflow checks.
- Short receipt/voucher examples occupy one page per original/copy. A standard voucher with both copies and an attached withholding certificate occupies three pages. PDPA examples occupy two pages. Long content continues as needed without reducing body type size.

## Reproduce

From the repository root, with the verified preview on port 5207:

```sh
TS_NODE_PROJECT=apps/api/tsconfig.json node -r ts-node/register/transpile-only docs/review/2026-09-11-document-style/render-specimens.cjs
node docs/review/2026-09-11-document-style/browser-specimens.mjs
node docs/review/2026-09-11-document-style/preview-check.mjs
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-style/inspect-pdfs.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-style/assemble-samples.py
```

The Python inspection/assembly scripts require PyMuPDF and Pillow. All fixtures are synthetic. The specimen harness validates render/layout behavior; financial and permission regression is covered separately by the isolated test harness. It does not certify every possible customized template or every printer driver. No staging account, production storage or physical printer was available; no deployment was performed.

## Final local handoff

- `LOCAL_PREVIEW_PORT=5207 npm run local:check`: **PASS** on the final source fingerprint recorded in `local-check.json`. Includes types, lint, Web/Shared/Storefront tests, Web/Storefront builds and browser smoke at 1440/390 px.
- Final PDF inspection: **50 files / 114 pages**, all TH Sarabun PSK; no blank text pages or bounds failures. Bounds check reserves 20 pt horizontal/15 pt vertical body safety; 12 pt contract footers use 10 pt bottom safety because they intentionally occupy the page margin. Thermal labels use their actual page box.
- Real contract/PDPA generation and authenticated download/upload/preview passed on both widths; PDF hashes matched stored bytes (`preview/check.json`).
- Review artifact: `output/pdf/BESTCHOICE-document-samples.pdf` contains 31 bookmarked examples / 51 pages using synthetic data.
- Verified preview left running: http://localhost:5207/contracts/9e8babd3-c27e-4ece-b451-10fcb242706a
