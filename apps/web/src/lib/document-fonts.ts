import type { jsPDF } from 'jspdf';
import { DOCUMENT_STYLE } from '@installment/shared';

const fontFiles = [
  { file: 'THSarabunPSK-Regular.ttf', style: 'normal' },
  { file: 'THSarabunPSK-Bold.ttf', style: 'bold' },
] as const;
const cachedFonts = new Map<string, Promise<string>>();

function loadFont(file: string): Promise<string> {
  const existing = cachedFonts.get(file);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(`/fonts/${file}`);
    if (!response.ok) throw new Error(`ไม่สามารถโหลดฟอนต์เอกสาร (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // TTF sfnt header. Do not cache an HTML error page returned with status 200.
    if (bytes.length < 12 || bytes[0] !== 0 || bytes[1] !== 1 || bytes[2] !== 0 || bytes[3] !== 0) {
      throw new Error('ไฟล์ฟอนต์เอกสารไม่ถูกต้อง');
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  })().catch(error => { cachedFonts.delete(file); throw error; });
  cachedFonts.set(file, pending);
  return pending;
}

/** Fail before export when a font is unavailable; a later click can retry. */
export async function loadDocumentFonts(doc: jsPDF): Promise<void> {
  const fonts = await Promise.all(fontFiles.map(async font => ({ ...font, data: await loadFont(font.file) })));
  for (const font of fonts) {
    doc.addFileToVFS(font.file, font.data);
    doc.addFont(font.file, DOCUMENT_STYLE.pdfFontFamily, font.style);
  }
  doc.setFont(DOCUMENT_STYLE.pdfFontFamily, 'normal');
}
