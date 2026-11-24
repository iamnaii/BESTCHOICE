# Receipt finance wording — 2026-11-24

Removed the external-finance explanatory sentence “ส่วนที่เหลือ … บาท ชำระกับ … ตามสัญญาของบริษัทไฟแนนซ์” from the sale receipt model/template, including its unused CSS. Retained finance reference, finance deduction, actual down payment, all contact details and one-page A4 layout.

Validation: sale-receipt HTML/PDF unit tests 25/25 pass; dedicated real-Puppeteer A4 layout test passes for cash/used, external finance/new and voided receipts. Final synthetic cash and GFIN PDFs each have one A4 page; Poppler renders visually reviewed. Read-only reviewer confirmed no notice consumers remain and totals are unchanged.

Outputs: `.tmp/receipt-finance/output/pdf/receipt-gfin-downpayment-a4.pdf` and `receipt-cash-used-a4.pdf`. Logs: `.tmp/receipt-finance/`.

Installment clarification (read-only): own BESTCHOICE installments use ReceiptPdfService, displaying “ค่างวดเช่าซื้อ งวดที่ N/total”, contract number and actual receipt amount. VAT-bearing receipts use the receipt/tax-invoice title. The sale-receipt endpoint rejects INSTALLMENT. Contract creation records SHOP downpayment accounting and CONTRACT_DOWN tenders but no production automatic DOWN_PAYMENT receipt issuance caller was found. Do not describe automatic own-downpayment PDF issuance as implemented.

No production writes or deployment. Full local check PASS 49/49 at 2026-11-24T07:46:37.229Z. Preview http://localhost:5218/products/create remains running with synthetic data/integrations. Fingerprint: `447a4816f8c16bcd1eae5a310400fe1f3c885a8cb5a0f5fce9943fdfc8cd42f8`. See `.tmp/local-preview/check.json`.
