# Document redesign — 11 September 2026

Requested: redesign ten document families and bring receipt/income/asset vouchers into the accepted receipt/credit-note visual family. Ordinary forms and the termination letter should fit a page; signatures must travel with a closing amount or statement.

## Delivered design

TH Sarabun PSK remains the contract baseline: body 16 pt, headings 18 pt, footer 12 pt. Shared transaction CSS uses emerald headings and totals, company information on the left, document identity on the right, compact party blocks, alternating table rows and aligned amounts. Transaction paper uses A4 with 14 mm vertical / 15 mm side margins; the contract retains its existing geometry. Termination letters keep their wording and use compact prose spacing.

The `ui-ux-pro-max` skill search returned web-oriented guidance. Paper hierarchy, spacing and contrast therefore follow the accepted receipt and general UX principles; web CTA, animation and replacement-font suggestions were not applied.

| Requested family | Implementation |
| --- | --- |
| Trade-in receipt | Common transaction header, device identifiers, credit/payment explanation, declaration and signatures |
| Tax invoice | Emerald identity, seller/buyer blocks, item table and emphasized total |
| Collections Report | KPI strip, titled sections, repeating table/document headers, page numbers |
| Termination letter | One-page normal/long-address fixtures in both API and client renderers; closing statement and signature reserved together |
| Payment voucher | Same hierarchy as receipts; original/copy preserved; summary travels with approval slots |
| Withholding certificate | FINANCE name/address/tax ID kept together; no combined SHOP/FINANCE issuer |
| Petty cash reimbursement | Compact vendor/account metadata, lines and reimbursement total; existing no-signature policy preserved |
| Payroll slip | Earnings/deductions side by side, custom items and exemption labels retained, one slip per employee |
| Daily expense summary | Compact 16-row example fits one page; unbounded category/account breakdowns can flow before total/signatures |
| Section 50 bis certificates | Consistent header and payer/payee layout for annual payroll and dividends |

Payment, down-payment, credit-note, early-payoff and reschedule receipts keep the accepted design and get compact pagination. Other-income and asset receipts use the same visual hierarchy. Unbounded notes are outside closing groups. No financial formulas, document permissions or legal wording were changed. The WHT issuer display was corrected to use FINANCE consistently.

## Verification

- Read-only reviewer: PASS, 0 Critical / 0 Warning after fixing letter closing reservation, FINANCE certificate identity and unbounded daily breakdowns.
- Isolated PostgreSQL harness: **11 suites / 145 tests passed**. No inherited application DB was used.
- Targeted API tests: **5 suites / 46 tests passed**. Mock-only unit tests also used deliberately unreachable DB URLs.
- Final `LOCAL_PREVIEW_PORT=5207 npm run local:check`: **PASS**, fingerprint recorded in `local-check.json`.
- Web **279 files / 1,979 tests**, Shared **5 files / 77 tests**, Storefront **7 files / 31 tests**; type, lint, build and 1440/390 browser checks passed.
- Rendered QA: **56 PDF files / 110 pages**, embedded Sarabun throughout, no blank text pages or page-bound warnings. Includes prior unchanged contract/template baseline fixtures.
- `check-layout.py`: **21 one-page forms**, original/copy/certificate counts, one payroll page per employee, retained custom earnings/deductions, FINANCE identity, all 24 categories/accounts and closing content with signatures.
- Boundary letters use repeated addresses at 8/12/16/20 lengths; the latter two actually cross a page and keep closing/signature together.
- All **24 pages** of the owner-facing sample PDF were rendered and visually inspected. Two contact sheets are stored here.

Ordinary forms fit one page per original/copy/employee. Collections and genuinely long tables can continue; totals or acknowledgment remain with the signatures. This does not promise a single page for arbitrary unbounded content or customized templates.

## Reproduce

With the checkout's verified preview on port 5207:

```sh
TS_NODE_PROJECT=apps/api/tsconfig.json node -r ts-node/register/transpile-only docs/review/2026-09-11-document-redesign/render-specimens.cjs
node docs/review/2026-09-11-document-redesign/browser-specimens.mjs
node docs/review/2026-09-11-document-redesign/preview-check.mjs
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-redesign/inspect-pdfs.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-redesign/check-layout.py
.tmp/pdf-qa-venv/bin/python docs/review/2026-09-11-document-redesign/assemble-samples.py
```

Python inspection requires PyMuPDF and Pillow. Specimens write `.tmp/document-style` for reuse of the existing synthetic contract baseline. The review PDF is `output/pdf/BESTCHOICE-document-redesign.pdf`: 20 bookmarked examples / 24 pages. All data are synthetic. No staging, production storage or physical printer was available. No deployment or external messages were performed.

Fresh backend verification also passed: actual contract/PDPA generation, PDF byte/hash matching, authenticated downloads and attachment upload/view at 1440 and 390 px (`preview/check.json`). The verified preview remains running at http://localhost:5207/contracts/9e8babd3-c27e-4ece-b451-10fcb242706a. The sample renderers exercise the redesigned documents with synthetic API fixtures; the limited preview is not a production accounting environment.
