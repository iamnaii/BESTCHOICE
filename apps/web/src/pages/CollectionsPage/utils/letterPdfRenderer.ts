/**
 * letterPdfRenderer.ts
 *
 * Client-side A4 PDF renderer for legal collection letters.
 * Supports two templates:
 *   - RETURN_DEVICE_45D  — demand notice + device return ultimatum
 *   - CONTRACT_TERMINATION_60D — contract termination + legal action notice
 *
 * Thai text is rendered using the THSarabunPSK font (loaded from /fonts/).
 * Font loading is shared with the existing template-editor pdfGenerator.
 */

import { jsPDF } from 'jspdf';

// ── Page geometry (A4 portrait, mm) ───────────────────────────────────────────
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 25;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ── Font constants (must match names registered by loadThaiFont) ───────────────
const PDF_FONT_FAMILY = 'THSarabunPSK';
const REQUIRED_FONTS = ['THSarabunPSK-Regular', 'THSarabunPSK-Bold'] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LetterTemplateData = {
  letterType: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';
  letterNumber: string;
  letterDate: Date;
  company: {
    nameTh: string;
    taxId: string;
    address: string;
    phone?: string | null;
    directorName: string;
    directorPosition?: string | null;
    logoUrl?: string | null;
    signatureUrl?: string | null;
  };
  customer: {
    name: string;
    address?: string | null;
  };
  contract: {
    contractNumber: string;
    contractDate?: Date | null;
    outstanding: number;
    daysOverdue: number;
  };
};

// ── Font loader ───────────────────────────────────────────────────────────────
// Module-level cache so font data is loaded only once per page session.
const _fontCache: Record<string, string> = {};

async function _ensureFont(fontName: string): Promise<void> {
  if (_fontCache[fontName]) return;
  try {
    const response = await fetch(`/fonts/${fontName}.ttf`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Convert in 8 KB chunks to avoid call-stack overflow on large font files
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    _fontCache[fontName] = btoa(binary);
  } catch (err) {
    console.warn(`[letterPdfRenderer] Failed to load font ${fontName}:`, err);
  }
}

async function loadThaiFont(doc: jsPDF): Promise<void> {
  await Promise.all(REQUIRED_FONTS.map((f) => _ensureFont(f)));

  const styles: Record<string, string> = {
    'THSarabunPSK-Regular': 'normal',
    'THSarabunPSK-Bold': 'bold',
  };

  for (const fontName of REQUIRED_FONTS) {
    const base64 = _fontCache[fontName];
    if (!base64) continue; // graceful fallback if fetch failed
    doc.addFileToVFS(`${fontName}.ttf`, base64);
    doc.addFont(`${fontName}.ttf`, PDF_FONT_FAMILY, styles[fontName] ?? 'normal');
  }
}

// ── Image helper ──────────────────────────────────────────────────────────────

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Date formatter ────────────────────────────────────────────────────────────

function formatThaiDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ── Number formatter ──────────────────────────────────────────────────────────

function formatMoney(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Section renderers ─────────────────────────────────────────────────────────

/**
 * Renders the top-of-page header:
 *   • Optional company logo top-left
 *   • Letter number + date top-right
 *   • Thin rule beneath
 */
function headerBlock(
  doc: jsPDF,
  data: LetterTemplateData,
  logoDataUrl: string | null,
): void {
  const topY = MARGIN;

  // Logo (30mm × 20mm)
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', MARGIN, topY, 30, 20);
    } catch {
      // Ignore — logo rendering is best-effort
    }
  }

  // Letter reference block, right-aligned
  doc.setFontSize(11);
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.setTextColor(0);
  doc.text(`เลขที่ ${data.letterNumber}`, PAGE_W - MARGIN, topY + 5, { align: 'right' });
  doc.text(
    `วันที่ ${formatThaiDate(data.letterDate)}`,
    PAGE_W - MARGIN,
    topY + 11,
    { align: 'right' },
  );

  // Company name beneath logo area (or left-aligned if no logo)
  doc.setFontSize(13);
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.text(data.company.nameTh, MARGIN, topY + 6);

  // Rule
  doc.setDrawColor(180);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, topY + 22, PAGE_W - MARGIN, topY + 22);

  doc.setFont(PDF_FONT_FAMILY, 'normal');
}

/**
 * Renders the centred letter title.
 * Returns the Y position after the title.
 */
function titleBlock(doc: jsPDF, title: string, yStart: number): number {
  doc.setFontSize(16);
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.text(title, PAGE_W / 2, yStart, { align: 'center' });
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  return yStart + 14;
}

/**
 * Renders the "เรียน / อ้างถึง" address block.
 * Returns the Y position after the block.
 */
function addressBlock(doc: jsPDF, data: LetterTemplateData, yStart: number): number {
  doc.setFontSize(14);
  let y = yStart;

  doc.text(`เรียน  ${data.customer.name}`, MARGIN, y);
  y += 7;

  if (data.customer.address) {
    doc.setTextColor(60);
    const addressLines = doc.splitTextToSize(
      `ที่อยู่  ${data.customer.address}`,
      CONTENT_W - 8,
    );
    doc.text(addressLines, MARGIN + 8, y);
    y += addressLines.length * 7;
    doc.setTextColor(0);
  }

  y += 3;

  doc.text(
    `อ้างถึง  สัญญาเช่าซื้อเลขที่ ${data.contract.contractNumber}`,
    MARGIN,
    y,
  );
  y += 7;

  if (data.contract.contractDate) {
    doc.text(
      `              ลงวันที่ ${formatThaiDate(data.contract.contractDate)}`,
      MARGIN,
      y,
    );
    y += 7;
  }

  // Thin separator
  doc.setDrawColor(210);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y + 1, PAGE_W - MARGIN, y + 1);

  return y + 6;
}

/**
 * RETURN_DEVICE_45D body — demand letter + device-return ultimatum.
 */
function bodyReturnDevice45D(
  doc: jsPDF,
  data: LetterTemplateData,
  yStart: number,
): number {
  doc.setFontSize(14);
  let y = yStart;
  const lineH = 7.5;

  // Paragraph 1 — facts
  const p1 =
    `     ด้วยท่านได้ทำสัญญาเช่าซื้อกับ ${data.company.nameTh} ` +
    `และมีภาระค้างชำระเป็นเวลา ${data.contract.daysOverdue} วัน ` +
    `รวมเป็นจำนวนเงินทั้งสิ้น ${formatMoney(data.contract.outstanding)} บาท ` +
    `บริษัทฯ ได้ดำเนินการติดตามทวงถามซ้ำหลายครั้งแล้ว แต่ไม่สามารถ` +
    `ติดต่อหรือได้รับการชำระจากท่านแต่อย่างใด`;
  const p1Lines = doc.splitTextToSize(p1, CONTENT_W);
  doc.text(p1Lines, MARGIN, y);
  y += p1Lines.length * lineH + 4;

  // Paragraph 2 — ultimatum intro
  const p2 =
    `     บัดนี้ บริษัทฯ จึงขอบอกกล่าวและกำหนดให้ท่านดำเนินการ` +
    `อย่างใดอย่างหนึ่งดังต่อไปนี้ ภายใน 15 วัน นับแต่วันที่ได้รับ` +
    `หนังสือฉบับนี้`;
  const p2Lines = doc.splitTextToSize(p2, CONTENT_W);
  doc.text(p2Lines, MARGIN, y);
  y += p2Lines.length * lineH + 3;

  // Option A
  doc.text(
    `     1.  ชำระยอดค้างชำระทั้งหมด ${formatMoney(data.contract.outstanding)} บาท พร้อมค่าธรรมเนียมล่าช้าที่เกิดขึ้น`,
    MARGIN,
    y,
  );
  y += lineH;

  // Option B
  doc.text(
    `     2.  ส่งมอบทรัพย์สินที่เช่าซื้อ (โทรศัพท์มือถือ) คืนแก่บริษัทฯ ใน` +
      `สภาพที่สมบูรณ์`,
    MARGIN,
    y,
  );
  y += lineH + 4;

  // Warning
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  const warn =
    `     หากท่านไม่ดำเนินการใดภายในกำหนดเวลาดังกล่าว บริษัทฯ ` +
    `จำเป็นต้องดำเนินการตามกระบวนการทางกฎหมายต่อไป โดยไม่จำเป็น` +
    `ต้องแจ้งให้ทราบล่วงหน้าอีก`;
  const warnLines = doc.splitTextToSize(warn, CONTENT_W);
  doc.text(warnLines, MARGIN, y);
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  return y + warnLines.length * lineH + 6;
}

/**
 * CONTRACT_TERMINATION_60D body — termination notice + legal action.
 */
function bodyContractTermination60D(
  doc: jsPDF,
  data: LetterTemplateData,
  yStart: number,
): number {
  doc.setFontSize(14);
  let y = yStart;
  const lineH = 7.5;

  // Paragraph 1 — recite prior notice
  const p1 =
    `     ตามที่ท่านได้ผิดนัดชำระค่างวดเป็นเวลา ${data.contract.daysOverdue} วัน ` +
    `ยอดค้างชำระรวม ${formatMoney(data.contract.outstanding)} บาท บริษัทฯ ` +
    `ได้มีหนังสือแจ้งเตือนและให้โอกาสท่านชำระหนี้หรือส่งมอบเครื่องคืน` +
    `แล้ว แต่ท่านมิได้ดำเนินการใด ๆ ภายในระยะเวลาที่กำหนด`;
  const p1Lines = doc.splitTextToSize(p1, CONTENT_W);
  doc.text(p1Lines, MARGIN, y);
  y += p1Lines.length * lineH + 4;

  // Paragraph 2 — termination declaration
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  const p2 =
    `     บริษัทฯ จึงขอบอกเลิกสัญญาเช่าซื้อฉบับดังกล่าวโดยมีผลทันทีนับ` +
    `แต่วันที่ท่านได้รับหนังสือนี้`;
  const p2Lines = doc.splitTextToSize(p2, CONTENT_W);
  doc.text(p2Lines, MARGIN, y);
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  y += p2Lines.length * lineH + 4;

  // Paragraph 3 — legal action notice
  const p3 =
    `     นับแต่นี้ บริษัทฯ จะมอบหมายให้ทนายความดำเนินคดีทางแพ่งและ` +
    `ทางอาญาเพื่อเรียกคืนทรัพย์สินและค่าเสียหายทั้งปวงตามกฎหมาย รวมถึง` +
    `ดำเนินการผ่านระบบ MDM เพื่อระงับการใช้งานอุปกรณ์ดังกล่าวโดยทันที`;
  const p3Lines = doc.splitTextToSize(p3, CONTENT_W);
  doc.text(p3Lines, MARGIN, y);
  y += p3Lines.length * lineH + 4;

  // Paragraph 4 — settlement invitation
  const p4 =
    `     อย่างไรก็ตาม หากท่านประสงค์จะเจรจาประนอมหนี้ กรุณาติดต่อ` +
    `บริษัทฯ ภายใน 7 วันนับแต่วันที่ได้รับหนังสือฉบับนี้`;
  const p4Lines = doc.splitTextToSize(p4, CONTENT_W);
  doc.text(p4Lines, MARGIN, y);
  return y + p4Lines.length * lineH + 6;
}

/**
 * Renders the closing "ขอแสดงความนับถือ" + signature block.
 * Signature image floats above the printed name.
 */
function signatureBlock(
  doc: jsPDF,
  data: LetterTemplateData,
  yStart: number,
  signatureDataUrl: string | null,
): void {
  const rightX = PAGE_W - MARGIN - 65;
  let y = yStart;

  doc.setFontSize(14);
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.text('ขอแสดงความนับถือ', rightX, y);
  y += 6;

  if (signatureDataUrl) {
    try {
      doc.addImage(signatureDataUrl, 'PNG', rightX, y, 50, 20);
    } catch {
      // Signature image is best-effort
    }
    y += 22;
  } else {
    // Blank signature line
    doc.setDrawColor(150);
    doc.setLineWidth(0.3);
    doc.line(rightX, y + 12, rightX + 60, y + 12);
    y += 18;
  }

  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.text(`(${data.company.directorName})`, rightX, y);
  y += 6;
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.setFontSize(12);
  if (data.company.directorPosition) {
    doc.text(data.company.directorPosition, rightX, y);
    y += 6;
  }
  doc.text(data.company.nameTh, rightX, y);
}

/**
 * Renders the small footer at the very bottom of the page:
 * company taxId + address + phone in muted text.
 */
function footerBlock(doc: jsPDF, data: LetterTemplateData): void {
  doc.setFontSize(9);
  doc.setTextColor(130);
  const parts = [
    data.company.nameTh,
    `เลขประจำตัวผู้เสียภาษี ${data.company.taxId}`,
    data.company.address,
    data.company.phone ? `โทร ${data.company.phone}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  const lines = doc.splitTextToSize(parts, CONTENT_W);
  doc.text(lines, MARGIN, PAGE_H - MARGIN + 3);
  doc.setTextColor(0);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Renders a legal letter PDF and returns it as a Blob.
 *
 * @example
 * const blob = await renderLetterPdf(data);
 * const url = URL.createObjectURL(blob);
 * window.open(url);
 */
export async function renderLetterPdf(data: LetterTemplateData): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  // Load Thai font — uses module-level cache so subsequent calls are instant
  await loadThaiFont(doc);

  // Activate font; fall back to helvetica if font loading failed entirely
  if (_fontCache['THSarabunPSK-Regular']) {
    doc.setFont(PDF_FONT_FAMILY, 'normal');
  } else {
    doc.setFont('helvetica', 'normal');
  }

  // Fetch optional images in parallel
  const [logoDataUrl, signatureDataUrl] = await Promise.all([
    data.company.logoUrl ? loadImageAsDataUrl(data.company.logoUrl) : Promise.resolve(null),
    data.company.signatureUrl
      ? loadImageAsDataUrl(data.company.signatureUrl)
      : Promise.resolve(null),
  ]);

  // ── Render sections ──────────────────────────────────────────────────────
  headerBlock(doc, data, logoDataUrl);

  const titleMap: Record<LetterTemplateData['letterType'], string> = {
    RETURN_DEVICE_45D: 'หนังสือทวงถามและเรียกให้ส่งมอบเครื่องคืน',
    CONTRACT_TERMINATION_60D: 'หนังสือบอกเลิกสัญญาและแจ้งดำเนินคดีทางกฎหมาย',
  };

  let y = titleBlock(doc, titleMap[data.letterType], MARGIN + 32);
  y = addressBlock(doc, data, y);

  y =
    data.letterType === 'RETURN_DEVICE_45D'
      ? bodyReturnDevice45D(doc, data, y)
      : bodyContractTermination60D(doc, data, y);

  signatureBlock(doc, data, y + 8, signatureDataUrl);
  footerBlock(doc, data);

  return doc.output('blob');
}
