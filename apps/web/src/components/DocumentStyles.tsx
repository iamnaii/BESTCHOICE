import { DOCUMENT_WEB_FONT_FACES, documentTypographyCss, transactionDocumentCss } from '@installment/shared';

/** Typography for paper only. Thermal labels keep their physical type scale. */
export default function DocumentStyles() {
  return <style>{`
    ${DOCUMENT_WEB_FONT_FACES}
    ${documentTypographyCss('.voucher-sheet', undefined, 1.15)}
    ${documentTypographyCss('.document-sheet')}
    .voucher-sheet :is(section,table) { margin-top: 12px !important; }
    .voucher-sheet h2 { margin-top: 8px !important; }
    .voucher-sheet footer { margin-top: 12px !important; padding-top: 8px !important; }
    .voucher-sheet .h-16 { height: 12mm !important; }

    .standard-voucher .voucher-meta-row { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 6px; }
    .standard-voucher .voucher-partial-cell { padding: 6px 8px; }
    .standard-voucher :is(th,td) { padding-top: 4px; padding-bottom: 4px; }
    .standard-voucher section > table { margin-top: 0 !important; }

    ${transactionDocumentCss()}
    .bc-document :is(section,table) { margin-top: 3mm !important; }
    .bc-document .bc-doc-closing > section:first-child { margin-top: 0 !important; }
    .bc-document section > table { margin-top: 0 !important; }
    .bc-document footer { margin-top: 3mm !important; padding-top: 1.5mm !important; }
    .bc-document :is(h1,h2,h3) { margin-top: 0 !important; }
    .bc-document .voucher-meta-row { display: grid; grid-template-columns: 29mm minmax(0,1fr); gap: 2mm; }
    .bc-document .voucher-partial-cell { border: 0; border-top: 1px solid #d4dfd9; border-radius: 0; padding: 2mm; }
    .bc-document .document-approval { align-items: end; }
    .bc-document .document-approval .h-16 { height: 12mm !important; }
    .bc-document .voucher-total-highlight td { background: #065f46 !important; color: white !important; }
    .bc-document .bc-doc-earnings { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 5mm; align-items: start; }
    .bc-document .bc-doc-earnings section { margin-top: 0 !important; }

    .bc-daily-sheet .rounded-xl { border: 0; border-radius: 0; padding: 0; }
    .bc-daily-sheet .bc-doc-breakdowns { gap: 3mm 6mm; }
    .bc-daily-sheet .px-4 { padding: 2mm 0; }
    .bc-daily-sheet h3 { color: #047857; }
    .bc-certificate .bc-doc-parties > div { border: 0; border-left: 2px solid #d4dfd9; border-radius: 0; padding: 2mm 3mm; }
    .bc-certificate > * + * { margin-top: 3mm; }
    .bc-certificate .bc-doc-closing { padding-top: 3mm; }
    @media print {
      html, body, #root { min-height: 0 !important; height: auto !important; }
      body:not(:has(.print-stickers)) {
        --background: 0 0% 100%; --foreground: 0 0% 8%;
        --card: 0 0% 100%; --card-foreground: 0 0% 8%;
        --muted: 0 0% 96%; --muted-foreground: 0 0% 30%;
        --border: 0 0% 75%; --input: 0 0% 75%;
      }
      body:not(:has(.print-stickers)) :is(div,p,span,a,li,td,th,h1,h2,h3,small,label,strong) { color: #111 !important; }
      .app-shell, .app-workspace, .wrapper, #main, .container-fluid {
        display: block !important; padding: 0 !important; margin: 0 !important;
        min-height: 0 !important; height: auto !important; width: 100% !important;
        max-width: none !important; overflow: visible !important; animation: none !important;
      }
      #main > .container-fluid > div { padding: 0 !important; max-width: none !important; }
      body:not(:has(.print-stickers)) input, body:not(:has(.print-stickers)) select { display: none !important; }

      ${documentTypographyCss('body:not(:has(.print-stickers))', undefined, 1.25)}
      ${documentTypographyCss('body .voucher-sheet', undefined, 1.15)}
      body:not(:has(.print-stickers)) [data-slot="table-wrapper"],
      body:not(:has(.print-stickers)) .overflow-x-auto,
      body:not(:has(.print-stickers)) [data-testid="data-table"].overflow-auto { overflow: visible !important; max-height: none !important; }
      body:not(:has(.print-stickers)) [data-testid="data-table"] table { min-width: 0 !important; }
      .app-shell, .app-workspace, .wrapper, #main, .container-fluid { background: white !important; }
      .voucher-sheet { min-height: auto !important; overflow: visible !important; }
      body:has(.document-print-dialog) #root,
      body:has(.document-print-dialog) [data-slot="dialog-overlay"] { display: none !important; }
      .document-print-dialog {
        position: static !important; transform: none !important; translate: none !important; animation: none !important;
        width: 100% !important; max-width: none !important; max-height: none !important;
        overflow: visible !important; border: 0 !important; box-shadow: none !important; padding: 0 !important;
      }
      .document-print-dialog > :not(.document-sheet) { display: none !important; }
      .document-print-dialog .document-sheet { padding: 0 !important; }
      body:has(.document-landscape):not(:has(.document-print-dialog)) { page: document-landscape; }
      .document-landscape table { table-layout: fixed; width: 100%; }
      .document-landscape :is(th,td) { padding: 5px 6px !important; line-height: 1.15 !important; }
      .document-landscape .tabular-nums, .document-landscape .font-mono { white-space: nowrap; }
      [data-testid="data-table"] th button { display: inline !important; font: inherit; }
      [data-testid="data-table"] th button svg { display: none; }
      .asset-register-sheet th:nth-child(1) { width: 10%; }
      .asset-register-sheet th:nth-child(2) { width: 18%; }
      .asset-register-sheet th:nth-child(3) { width: 10%; }
      .asset-register-sheet th:nth-child(4) { width: 9%; }
      .asset-register-sheet th:nth-child(5) { width: 10%; }
      .asset-register-sheet th:nth-child(6) { width: 11%; }
      .asset-register-sheet th:nth-child(7) { width: 11%; }
      .asset-register-sheet th:nth-child(8) { width: 8%; }
      .asset-register-sheet th:nth-child(9) { width: 13%; }
      body:has(.bc-document) { page: bc-transaction; }
      ${transactionDocumentCss('body .bc-document')}
      body .bc-daily-sheet :is(th,td) { padding: 0.6mm 1.5mm; }
      body .bc-daily-sheet table { margin-top: 1.5mm !important; }
      body .bc-daily-sheet .bc-doc-brand { display: flex; align-items: center; gap: 3mm; }
      body .bc-daily-sheet .bc-doc-brand img { height: 8mm; margin: 0; }
      body .bc-daily-sheet .bc-doc-approval { padding-top: 8mm; margin-top: 2mm; align-items: start; }
      body .bc-daily-sheet .bc-doc-closing { margin-top: 2mm; }
      @page bc-transaction { size: A4; margin: 14mm 15mm; }
      @page document-landscape { size: A4 landscape; margin: 20mm 19mm; }
    }
  `}</style>;
}
