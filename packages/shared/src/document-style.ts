/** Printed document baseline, matching the hire-purchase contract. Sizes are points. */
export const DOCUMENT_STYLE = {
  fontFamily: 'TH Sarabun PSK',
  pdfFontFamily: 'THSarabunPSK',
  bodyPt: 16,
  headingPt: 18,
  footerPt: 12,
  lineHeight: 1.5,
  marginsMm: { top: 20, right: 19, bottom: 20, left: 19 },
} as const;

export const DOCUMENT_WEB_FONT_FACES = [
  ['Regular', 400], ['Bold', 700],
].map(([name, weight]) => `@font-face { font-family: '${DOCUMENT_STYLE.fontFamily}'; src: url('/fonts/THSarabunPSK-${name}.ttf') format('truetype'); font-weight: ${weight}; font-style: normal; font-display: block; }`).join('\n');

/** Apply only inside a document, never to the surrounding application controls. */
export function documentTypographyCss(root = 'body', sizes: { body: number; heading: number; footer: number } = { body: DOCUMENT_STYLE.bodyPt, heading: DOCUMENT_STYLE.headingPt, footer: DOCUMENT_STYLE.footerPt }, lineHeight: number = DOCUMENT_STYLE.lineHeight): string {
  return `
${root}, ${root} :is(div,p,span,li,td,th,a,label,strong,b,em,u,small,dt,dd,section,article,header,footer) {
  font-family: '${DOCUMENT_STYLE.fontFamily}', sans-serif !important;
  font-size: ${sizes.body}pt !important;
  line-height: ${lineHeight} !important;
  letter-spacing: normal;
}
${root} :is(h1,h2,h3,h4,h5,h6,.section-heading,.doc-title,.doc-title *,.document-title,.document-title *,.company-name,.company-name *,h1 *,h2 *,h3 *,h4 *,h5 *,h6 *) {
  font-family: '${DOCUMENT_STYLE.fontFamily}', sans-serif !important;
  font-size: ${sizes.heading}pt !important;
  line-height: ${DOCUMENT_STYLE.lineHeight} !important;
  break-after: avoid;
}
${root} :is(.document-footer,.document-footer *,footer,footer *,.doc-note) {
  font-size: ${sizes.footer}pt !important;
}
${root} table { border-collapse: collapse; }
${root} thead { display: table-header-group; }
${root} tfoot { display: table-row-group; }
${root} tr { break-inside: avoid; }
${root} :is(td,th) { vertical-align: top; overflow-wrap: anywhere; }
${root} :is(p,li) { orphans: 3; widows: 3; }
${root} :is(.signature,.approval,.document-approval,.sig-block,.totals,.grand-card,.no-break) { break-inside: avoid; }
${root} :is(.void-overlay,.watermark) { font-size: 64pt !important; }
${root} .sig-handwriting { transform: none; font-style: normal; }
`;
}

/** Margin space repeats on every page; padding on body only protects page one. */
export const DOCUMENT_A4_CSS = `
@page { size: A4; margin: 20mm 19mm; }
html, body { margin: 0; padding: 0; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
