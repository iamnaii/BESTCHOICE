import { documentTypographyCss } from './document-style';

/** Paper layout for transaction documents; the contract retains its own geometry. */
export const TRANSACTION_PAGE_CSS = '@page { size: A4; margin: 18mm 15mm; }';
export function transactionDocumentCss(root = '.bc-document'): string {
  return `
${documentTypographyCss(root, undefined, 1.08)}
${root} { color: #172b25; background: white; }
${root} * { box-sizing: border-box; }
${root} :is(h1,h2,h3,p) { margin: 0; }
${root} :is(h1,h2,h3,.doc-title,.company-name) { line-height: 1.15 !important; }
${root} .bc-doc-header { display: grid; grid-template-columns: minmax(0,1.4fr) minmax(0,1fr); gap: 6mm; padding-bottom: 3mm; border-bottom: 2px solid #065f46; margin-bottom: 3mm; text-align: left; }
${root} .bc-doc-header > *, ${root} .bc-doc-parties > * { min-width: 0; overflow-wrap: anywhere; }
${root} .bc-doc-brand img, ${root} .bc-doc-brand svg { display: block; width: auto; height: 10mm; margin-bottom: 2mm; object-fit: contain; }
${root} .bc-doc-company { font-weight: 700; }
${root} .bc-doc-identity { text-align: right; }
${root} .bc-doc-identity h1 { color: #065f46; font-weight: 700; margin-bottom: 1mm; }
${root} .bc-doc-kicker, ${root} .bc-doc-kicker * { font-size: 12pt !important; color: #52645d; }
${root} .bc-doc-meta { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 1mm 3mm; margin-top: 2mm; }
${root} .bc-doc-meta > :nth-child(odd) { color: #52645d; }
${root} .bc-doc-meta > :nth-child(even) { font-weight: 700; overflow-wrap: anywhere; }
${root} .bc-doc-parties { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 5mm; padding: 2mm 0 3mm; border-bottom: 1px solid #d4dfd9; margin-bottom: 3mm; }
${root} .bc-doc-label { color: #047857; font-weight: 700; margin-bottom: 1mm; }
${root} .bc-doc-kv { display: grid; grid-template-columns: 30mm minmax(0,1fr); gap: 1mm 2mm; }
${root} .bc-doc-kv > :nth-child(odd) { color: #52645d; }
${root} .bc-doc-kv > :nth-child(even) { overflow-wrap: anywhere; }
${root} table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
${root} thead th { background: #065f46 !important; color: #fff !important; font-weight: 700; text-align: left; }
${root} :is(th,td) { padding: 1.5mm 2mm; border: 0; border-bottom: 1px solid #dce5df; }
${root} tbody tr:nth-child(even) td { background: #f6f9f7; }
${root} :is(.right,.text-right) { text-align: right; }
${root} :is(.num,.tabular-nums) { font-variant-numeric: tabular-nums; }
${root} :is(td.right,td.tabular-nums) { white-space: nowrap; overflow-wrap: normal; }
${root} .bc-doc-closing { break-inside: avoid; margin-top: 3mm; }
${root} .bc-doc-total-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 5mm; align-items: start; }
${root} .bc-doc-total-grid > * { min-width: 0; overflow-wrap: anywhere; }
${root} .bc-doc-totals { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 1.5mm 3mm; }
${root} .bc-doc-totals > :nth-child(even) { text-align: right; white-space: nowrap; }
${root} .bc-doc-grand { display: flex; justify-content: space-between; gap: 3mm; padding: 2mm 3mm; background: #065f46 !important; color: white !important; margin-top: 2mm; border-radius: 2mm; font-weight: 700; }
${root} .bc-doc-grand * { color: white !important; }
${root} .bc-doc-note { margin: 2mm 0; overflow-wrap: anywhere; }
${root} .bc-doc-approval { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0,1fr); gap: 5mm; align-items: end; margin-top: 4mm; }
${root} .bc-doc-signature { text-align: center; min-width: 0; overflow-wrap: anywhere; }
${root} .bc-doc-signature .sign-space { height: 12mm; display: flex; align-items: end; justify-content: center; border-bottom: 1px solid #9caea4; margin-bottom: 1mm; }
${root} .bc-doc-signature .sign-space img { max-height: 12mm; max-width: 100%; object-fit: contain; }
${root} .bc-doc-qr { width: 24mm; text-align: center; }
${root} .bc-doc-qr img { width: 22mm; height: 22mm; }
${root} .bc-doc-footer { border-top: 1px solid #dce5df; padding-top: 1.5mm; margin-top: 3mm; color: #52645d; display: flex; justify-content: space-between; gap: 4mm; }
${root} .bc-doc-footer, ${root} .bc-doc-footer * { font-size: 12pt !important; }
`;
}
