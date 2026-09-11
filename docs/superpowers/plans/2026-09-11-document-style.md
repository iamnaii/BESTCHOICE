# Unified document typography and layout

User explicitly requested all system documents use the contract font and size, with layout adjustment. Baseline: TH Sarabun PSK regular/bold, body/table 16 pt, heading 18 pt, footer 12 pt, line-height 1.5. Keep data, financial calculations and legal wording unchanged. Existing issued PDFs are preserved; new renders use the new style.

- [x] Shared typography and cached offline font adapters for HTML and jsPDF.
- [x] Contract/PDPA, payment receipts/credit notes, trade-in, other-income, expense, asset and collection-letter PDFs.
- [x] E-tax/report PDFs and browser print pages; align template preview pt units with PDF.
- [x] Adjust compact layouts for actual 16 pt text, pagination, table headers and signatures.
- [x] Render representative normal/long cases with real fonts, inspect every PDF page, test relevant logic and perform independent review.
- [x] Final local check, fresh feature preview and local commit; leave preview running.

Product stickers use a fixed 50×30 mm label canvas; assess separately from A4 documents so the barcode and model remain printable.
