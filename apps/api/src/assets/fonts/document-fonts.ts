import { readFileSync } from 'fs';
import { join } from 'path';
import type { jsPDF } from 'jspdf';
import { DOCUMENT_STYLE } from '@installment/shared';

// Nest copies these exact assets alongside this module in production.
const fonts = [
  { file: 'THSarabunPSK-Regular.ttf', style: 'normal', weight: 400 },
  { file: 'THSarabunPSK-Bold.ttf', style: 'bold', weight: 700 },
] as const;
let cached: { file: string; style: string; weight: number; base64: string }[] | undefined;
function getFonts() {
  return cached ??= fonts.map(font => ({ ...font, base64: readFileSync(join(__dirname, font.file)).toString('base64') }));
}

export function embeddedDocumentFonts(): string {
  return getFonts().map(font => `@font-face { font-family: '${DOCUMENT_STYLE.fontFamily}'; font-style: normal; font-weight: ${font.weight}; src: url(data:font/ttf;base64,${font.base64}) format('truetype'); font-display: block; }`).join('\n');
}

export function registerDocumentFont(doc: jsPDF): string {
  for (const font of getFonts()) {
    doc.addFileToVFS(font.file, font.base64);
    doc.addFont(font.file, DOCUMENT_STYLE.pdfFontFamily, font.style);
  }
  doc.setFont(DOCUMENT_STYLE.pdfFontFamily, 'normal');
  return DOCUMENT_STYLE.pdfFontFamily;
}
