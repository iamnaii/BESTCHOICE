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
import { formatThaiDateLong } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';
import { numToThaiText } from '@/utils/numToThaiText';

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
  // ── Optional rich detail for RETURN_DEVICE_45D template ──────────────────
  // These fields drive the long-form demand letter body. When absent, the
  // renderer falls back to a shorter generic version.
  product?: {
    brand: string;
    model: string;
    storage?: string | null;
    color?: string | null;
    imei?: string | null;
  };
  paymentSchedule?: {
    totalMonths: number;
    monthlyPayment: number;
    paymentDueDay?: number | null;
    firstDueDate?: Date | null;
  };
  overdueDetail?: {
    /** Human-readable Thai month-year strings, e.g. ["เมษายน 2569"] */
    overdueMonths: string[];
    /** Count of overdue installments (used in "ติดต่อกันเป็นจำนวน N งวด"). */
    overdueInstallments: number;
    /** Unpaid principal only (excludes late-fee). */
    principalAmount: number;
    /** Sum of late-fees across overdue installments. */
    lateFeeAmount: number;
  };
  coordinator?: {
    name: string;
    phone: string;
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

// ── Date & money formatters ───────────────────────────────────────────────────
//
// Legal letters are court-submitted documents — dates MUST render in พ.ศ.
// (Thai Buddhist Era) consistently. We use the shared `formatThaiDateLong`
// helper from `@/lib/date` (e.g. "8 เมษายน 2569") instead of
// `toLocaleDateString('th-TH', ...)` whose output varies by browser/ICU
// version (some environments render ค.ศ. or drop the พ.ศ. offset entirely).
//
// Money is formatted via the shared `formatNumberDecimal` (th-TH locale,
// 2 decimal places) — keeps PDF output identical to on-screen displays.

const formatThaiDate = (d: Date): string => formatThaiDateLong(d);
const formatMoney = (n: number): string => formatNumberDecimal(n, 2);

// ── Section renderers ─────────────────────────────────────────────────────────

/**
 * Renders the top-of-page header (matches the company's printed letterhead):
 *   • Optional company logo top-left
 *   • Company name (bold) beside logo
 *   • Company address (smaller) beneath the company name
 *   • Thin rule beneath
 *
 * Date now renders right-aligned BELOW the rule (handled by the caller in
 * renderLetterPdfDoc) — matches the reference PDF.
 */
function headerBlock(
  doc: jsPDF,
  data: LetterTemplateData,
  logoDataUrl: string | null,
): void {
  const topY = MARGIN;

  // Logo (20mm × 20mm — square to match reference)
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', MARGIN, topY, 20, 20);
    } catch {
      // Ignore — logo rendering is best-effort
    }
  }

  const textX = logoDataUrl ? MARGIN + 24 : MARGIN;

  // Company name (bold, larger)
  doc.setFontSize(15);
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.text(data.company.nameTh, textX, topY + 7);

  // Company address (small, normal weight)
  doc.setFontSize(11);
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  const addressLines = doc.splitTextToSize(
    data.company.address,
    PAGE_W - textX - MARGIN,
  );
  doc.text(addressLines, textX, topY + 13);

  // Rule
  doc.setDrawColor(120);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, topY + 25, PAGE_W - MARGIN, topY + 25);
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
 *
 * Layout matches the company's printed reference:
 *   - "เรียน คุณ[name]"  (no separate "ที่อยู่" line)
 *   - "อ้างถึง สัญญาเช่าซื้อโทรศัพท์มือถือ เลขที่ X ลงวันที่ Y"  (single line, wraps if too long)
 *   - No separator line below — body follows directly
 */
function addressBlock(doc: jsPDF, data: LetterTemplateData, yStart: number): number {
  doc.setFontSize(14);
  let y = yStart;

  doc.text(`เรียน  ${data.customer.name}`, MARGIN, y);
  y += 9;

  const refText = data.contract.contractDate
    ? `อ้างถึง  สัญญาเช่าซื้อโทรศัพท์มือถือ เลขที่ ${data.contract.contractNumber} ` +
      `ลงวันที่ ${formatThaiDate(data.contract.contractDate)}`
    : `อ้างถึง  สัญญาเช่าซื้อโทรศัพท์มือถือ เลขที่ ${data.contract.contractNumber}`;
  const refLines = doc.splitTextToSize(refText, CONTENT_W);
  doc.text(refLines, MARGIN, y);
  y += refLines.length * 7;

  return y + 4;
}

/**
 * RETURN_DEVICE_45D body — demand letter + device-return ultimatum.
 *
 * Layout follows the company's reference template:
 *   1. Facts paragraph (product details + payment schedule)
 *   2. Default declaration (which months were missed + contract clauses violated)
 *   3. Demand intro
 *   4. Numbered list: pay or return (with exact amounts + total in Thai words)
 *   5. Legal action section (4 numbered points)
 *   6. Coordinator contact line
 *   7. "จึงเรียนมาเพื่อโปรดดำเนินการโดยเร่งด่วน"
 *
 * When `product`/`paymentSchedule`/`overdueDetail`/`coordinator` are missing,
 * each section degrades gracefully (placeholders or omitted lines) so the
 * letter still produces a valid PDF.
 */
function bodyReturnDevice45D(
  doc: jsPDF,
  data: LetterTemplateData,
  yStart: number,
): number {
  doc.setFontSize(14);
  let y = yStart;
  const lineH = 7;

  const write = (text: string, extraGap = 4): void => {
    const lines = doc.splitTextToSize(text, CONTENT_W);
    doc.text(lines, MARGIN, y);
    y += lines.length * lineH + extraGap;
  };
  const writeIndent = (text: string, extraGap = 0): void => {
    const lines = doc.splitTextToSize(text, CONTENT_W - 6);
    doc.text(lines, MARGIN + 6, y);
    y += lines.length * lineH + extraGap;
  };

  // ── Paragraph 1: facts (product + schedule) ─────────────────────────────
  const product = data.product;
  const schedule = data.paymentSchedule;
  const productDesc = product
    ? `ยี่ห้อ ${product.brand} รุ่น ${product.model}` +
      (product.storage ? ` ${product.storage}` : '') +
      (product.color ? ` สี${product.color}` : '') +
      (product.imei ? ` หมายเลข IMEI ${product.imei}` : '')
    : 'ทรัพย์สินที่เช่าซื้อ';

  const scheduleDesc = schedule
    ? `จำนวน ${schedule.totalMonths} งวด งวดละ ${formatMoney(schedule.monthlyPayment)} บาท` +
      (schedule.paymentDueDay ? ` ทุกวันที่ ${schedule.paymentDueDay} ของเดือน` : '') +
      (schedule.firstDueDate
        ? ` โดยเริ่มชำระงวดแรกในวันที่ ${formatThaiDate(schedule.firstDueDate)}`
        : '')
    : '';

  const p1 =
    `     ตามที่ท่านได้ทำสัญญาเช่าซื้อโทรศัพท์มือถือ ${productDesc} ` +
    `(ต่อไปนี้เรียกว่า "ทรัพย์สินที่เช่าซื้อ") กับ ${data.company.nameTh} ` +
    `("บริษัทฯ") โดยท่านตกลงที่จะชำระค่าเช่าซื้อเป็นรายเดือน ${scheduleDesc} ` +
    `ตามรายละเอียดที่ปรากฏในสัญญานั้น`;
  write(p1, 4);

  // ── Paragraph 2: default declaration ────────────────────────────────────
  const overdue = data.overdueDetail;
  const overdueMonthsText =
    overdue && overdue.overdueMonths.length > 0
      ? overdue.overdueMonths.join(', ')
      : `${data.contract.daysOverdue} วัน`;
  const overdueCountText = overdue
    ? `ติดต่อกันเป็นจำนวน ${overdue.overdueInstallments} งวด `
    : '';
  const p2 =
    `     ปรากฏว่า บัดนี้ท่านได้ผิดนัดชำระค่าเช่าซื้องวดประจำเดือน ` +
    `${overdueMonthsText} ${overdueCountText}อันเป็นการผิดสัญญาเช่าซื้อในข้อ 8 ` +
    `(การผิดนัดชำระหนี้/ผิดเงื่อนไขสัญญา) และ ข้อ 20 (การผิดสัญญาและการสิ้นสุดของสัญญา)`;
  write(p2, 4);

  // ── Paragraph 3: demand intro ───────────────────────────────────────────
  write(`     บริษัทฯ จึงขอให้ท่านดำเนินการอย่างหนึ่งอย่างใด ดังต่อไปนี้`, 3);

  // ── Numbered list 1: pay or return ──────────────────────────────────────
  const principal = overdue?.principalAmount ?? data.contract.outstanding;
  const lateFee = overdue?.lateFeeAmount ?? 0;
  const grandTotal = principal + lateFee;
  const grandTotalWords = numToThaiText(grandTotal);

  doc.setFont(PDF_FONT_FAMILY, 'normal');
  writeIndent(
    `1. ชำระค่าเช่าซื้อที่ค้างชำระทั้งหมด จำนวน ${formatMoney(principal)} บาท ` +
      `พร้อมเบี้ยปรับ ${formatMoney(lateFee)} บาท รวมเป็นเงินทั้งสิ้น ` +
      `${formatMoney(grandTotal)} บาท (${grandTotalWords}) ภายใน 7 วัน ` +
      `นับตั้งแต่วันที่ท่านได้รับจดหมายฉบับนี้`,
    2,
  );

  writeIndent(
    `2. หรือ หากท่านไม่สามารถชำระค่าเช่าซื้อที่ค้างได้ ขอให้ท่าน ` +
      `ส่งมอบทรัพย์สินที่เช่าซื้อคืน แก่บริษัทฯ ณ ที่ทำการของบริษัทฯ หรือ ` +
      `ตามที่อยู่ ${data.company.nameTh} ${data.company.address} ` +
      `ภายใน 7 วันนับแต่วันที่ได้รับจดหมายฉบับนี้ ในสภาพที่สมบูรณ์ตามสมควร`,
    6,
  );

  // ── Section heading: legal action ───────────────────────────────────────
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  write('การดำเนินการทางกฎหมายหากท่านเพิกเฉย', 3);
  doc.setFont(PDF_FONT_FAMILY, 'normal');

  write(
    `     หากพ้นกำหนดเวลาดังกล่าวแล้ว ท่านยังคงเพิกเฉยไม่ดำเนินการชำระหนี้ ` +
      `หรือไม่ส่งมอบทรัพย์สินที่เช่าซื้อคืน บริษัทฯ มีความจำเป็นต้องดำเนินการ` +
      `ตามสิทธิ์ในสัญญาและตามกฎหมายอย่างเด็ดขาด ดังนี้`,
    3,
  );

  // ── Numbered list 2: 4 legal actions ────────────────────────────────────
  const legalItems: Array<{ title: string; body: string }> = [
    {
      title: 'การบอกเลิกสัญญา',
      body: 'บริษัทฯ จะใช้สิทธิ์บอกเลิกสัญญาเช่าซื้อฉบับนี้ทันที ตามที่ระบุไว้ในสัญญา ข้อ 20 (การผิดสัญญาและการสิ้นสุดของสัญญา) ข้อ 3',
    },
    {
      title: 'การยึดคืนทรัพย์สิน',
      body: 'บริษัทฯ มีสิทธิ์กลับเข้าครอบครองและยึดคืนทรัพย์สินที่เช่าซื้อจากท่านทันที ไม่ว่าทรัพย์สินนั้นจะอยู่ที่ใดก็ตาม (ตามสัญญา ข้อ 20 และ ข้อ 21)',
    },
    {
      title: 'การดำเนินคดีทางแพ่ง',
      body: 'บริษัทฯ จะฟ้องร้องดำเนินคดีต่อศาล เพื่อเรียกร้องให้ท่านส่งคืนทรัพย์สิน และ/หรือ ชำระหนี้ค่าเช่าซื้อที่ค้างอยู่ทั้งหมด หากนำทรัพย์สินออกขายทอดตลาดแล้วได้เงินไม่เพียงพอ ท่านยังคงต้องรับผิดชอบในส่วนต่างที่ขาดอยู่ พร้อมทั้งค่าเสียหาย ค่าใช้จ่ายในการติดตามทวงถาม และค่าฤชาธรรมเนียมศาล (ตามสัญญา ข้อ 21)',
    },
    {
      title: 'การดำเนินคดีทางอาญา',
      body: 'หากท่านไม่ส่งมอบทรัพย์สินคืน หรือนำทรัพย์สินไปซุกซ่อน จำหน่ายจ่ายโอน หรือทำให้เสียหาย การกระทำดังกล่าวอาจเข้าข่ายเป็น ความผิดอาญาฐานยักยอกทรัพย์ ซึ่งบริษัทฯ จะดำเนินคดีตามกฎหมายจนถึงที่สุด',
    },
  ];

  legalItems.forEach((item, idx) => {
    doc.setFont(PDF_FONT_FAMILY, 'bold');
    const titleText = `${idx + 1}. ${item.title}`;
    doc.text(titleText, MARGIN + 6, y);
    doc.setFont(PDF_FONT_FAMILY, 'normal');
    // Title + body share the same line then wrap
    const titleW = doc.getTextWidth(titleText + ' ');
    const bodyLines = doc.splitTextToSize(item.body, CONTENT_W - 6 - titleW);
    doc.text(bodyLines[0] ?? '', MARGIN + 6 + titleW, y);
    y += lineH;
    if (bodyLines.length > 1) {
      const rest = doc.splitTextToSize(bodyLines.slice(1).join(' '), CONTENT_W - 12);
      doc.text(rest, MARGIN + 12, y);
      y += rest.length * lineH;
    }
    y += 1;
  });
  y += 3;

  // ── Coordinator contact ─────────────────────────────────────────────────
  const coord = data.coordinator;
  if (coord) {
    write(
      `     หากท่านต้องการติดต่อเพื่อดำเนินการดังกล่าว หรือมีข้อสงสัยประการใด ` +
        `โปรดติดต่อ คุณ ${coord.name} เจ้าหน้าที่ประสานงาน ` +
        `ได้ที่หมายเลขโทรศัพท์ ${coord.phone}`,
      4,
    );
  } else if (data.company.phone) {
    write(
      `     หากท่านมีข้อสงสัยประการใด โปรดติดต่อบริษัทฯ ได้ที่หมายเลขโทรศัพท์ ` +
        `${data.company.phone}`,
      4,
    );
  }

  // ── Closing ─────────────────────────────────────────────────────────────
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  write('     จึงเรียนมาเพื่อโปรดดำเนินการโดยเร่งด่วน', 4);
  doc.setFont(PDF_FONT_FAMILY, 'normal');

  return y;
}

/**
 * CONTRACT_TERMINATION_60D body — termination notice + legal action.
 *
 * Layout follows the company's reference template:
 *   1. Facts paragraph (product details + monthly payment + N installments)
 *   2. Default declaration (overdue starting from month X, cumulative outstanding,
 *      references prior notice, cites contract clauses 5 + 20)
 *   3. Termination declaration ("จดหมายฉบับนี้ ... ขอบอกเลิก ... ภายใน 7 วัน")
 *   4. Two indented bullet demands (NOT numbered): return device, pay debt
 *      (with Thai-word total)
 *   5. Legal action paragraph (civil + criminal, with prison/fine clause)
 *   6. Coordinator contact line (bolded name + phone)
 *   7. Closing: "จึงเรียนมาเพื่อโปรดดำเนินการ"
 *
 * When optional rich fields are missing the renderer degrades gracefully.
 */
function bodyContractTermination60D(
  doc: jsPDF,
  data: LetterTemplateData,
  yStart: number,
): number {
  doc.setFontSize(14);
  let y = yStart;
  const lineH = 7;

  const write = (text: string, extraGap = 4): void => {
    const lines = doc.splitTextToSize(text, CONTENT_W);
    doc.text(lines, MARGIN, y);
    y += lines.length * lineH + extraGap;
  };

  // ── Paragraph 1: facts ──────────────────────────────────────────────────
  const product = data.product;
  const schedule = data.paymentSchedule;
  const productDesc = product
    ? `ยี่ห้อ ${product.brand} รุ่น ${product.model}` +
      (product.storage ? ` ${product.storage}` : '') +
      (product.color ? ` สี${product.color}` : '') +
      (product.imei ? ` หมายเลข IMEI ${product.imei}` : '')
    : 'ทรัพย์สินที่เช่าซื้อ';

  const scheduleDesc = schedule
    ? ` โดยตกลงชำระค่าเช่าซื้อเป็นรายเดือน เดือนละ ${formatMoney(schedule.monthlyPayment)} บาท ` +
      `จำนวน ${schedule.totalMonths} งวด นั้น`
    : '';

  const p1 =
    `     ตามที่ท่านได้ทำสัญญาเช่าซื้อโทรศัพท์มือถือ ${productDesc} ` +
    `("ทรัพย์สินที่เช่าซื้อ") จากกับ ${data.company.nameTh} ("บริษัทฯ")` +
    scheduleDesc;
  write(p1, 4);

  // ── Paragraph 2: default declaration ────────────────────────────────────
  const overdue = data.overdueDetail;
  const firstOverdueMonth =
    overdue && overdue.overdueMonths.length > 0
      ? overdue.overdueMonths[0]
      : null;
  const overdueStartText = firstOverdueMonth
    ? `ตั้งแต่งวดประจำเดือน ${firstOverdueMonth} เป็นต้นมา `
    : '';
  const p2 =
    `     ปรากฏว่าท่านได้ผิดนัดชำระค่าเช่าซื้อ${overdueStartText}` +
    `จนถึงปัจจุบันท่านมียอดค้างชำระสะสมรวมทั้งสิ้น ` +
    `${formatMoney(data.contract.outstanding)} บาท ซึ่งบริษัทฯ ` +
    `ได้เคยมีจดหมายแจ้งเตือนให้ท่านชำระหนี้แล้ว แต่ท่านยังคงเพิกเฉย` +
    `อันเป็นการผิดนัดสัญญาข้อ 5 และ ข้อ 20 นั้น`;
  write(p2, 4);

  // ── Paragraph 3: termination declaration ────────────────────────────────
  const p3 =
    `     โดยจดหมายฉบับนี้ บริษัทฯ ในฐานะผู้ให้เช่าซื้อ จึงขอ` +
    `บอกเลิกสัญญาเช่าซื้อฉบับดังกล่าวกับท่านทันที และขอให้ท่าน` +
    `ดำเนินการดังต่อไปนี้ภายใน 7 วัน นับแต่วันที่ท่านได้รับจดหมายฉบับนี้:`;
  write(p3, 3);

  // ── Two bullet demands (bold lead label, body continues inline) ─────────
  const totalWords = numToThaiText(data.contract.outstanding);

  const bulletLeads: Array<{ label: string; body: string }> = [
    {
      label: 'ส่งมอบทรัพย์สินที่เช่าซื้อคืน',
      body:
        `: ให้ท่านนำโทรศัพท์มือถือเครื่องดังกล่าวส่งมอบคืนแก่บริษัทฯ ` +
        `ณ ที่ทำการของบริษัทฯ ในสภาพที่สมบูรณ์พร้อมใช้งาน`,
    },
    {
      label: 'ชำระหนี้ค้างชำระและค่าเสียหาย',
      body:
        `: ให้ท่านชำระค่าเช่าซื้อที่ค้างชำระพร้อมเบี้ยปรับ และค่าขาด` +
        `ประโยชน์จากการใช้ทรัพย์ เป็นเงินจำนวน ` +
        `${formatMoney(data.contract.outstanding)} บาท (${totalWords})`,
    },
  ];

  for (const bullet of bulletLeads) {
    doc.setFont(PDF_FONT_FAMILY, 'bold');
    const labelText = `     ${bullet.label}`;
    doc.text(labelText, MARGIN, y);
    doc.setFont(PDF_FONT_FAMILY, 'normal');
    const labelW = doc.getTextWidth(labelText);
    // Wrap the body; first line continues after the bold label
    const bodyLines = doc.splitTextToSize(bullet.body, CONTENT_W - labelW);
    if (bodyLines.length > 0) {
      doc.text(bodyLines[0], MARGIN + labelW, y);
    }
    y += lineH;
    if (bodyLines.length > 1) {
      const restLines = doc.splitTextToSize(bodyLines.slice(1).join(' '), CONTENT_W);
      doc.text(restLines, MARGIN, y);
      y += restLines.length * lineH;
    }
    y += 2;
  }
  y += 2;

  // ── Paragraph 5: legal action (single block) ────────────────────────────
  const p5 =
    `     หากท่านเพิกเฉยไม่ดำเนินการภายในกำหนดเวลาข้างต้น บริษัทฯ ` +
    `มีความจำเป็นต้องดำเนินการตามกฎหมายอย่างเด็ดขาด ทั้งในคดีแพ่ง` +
    `เพื่อเรียกค่าเสียหายและค่าขาดประโยชน์จนถึงที่สุด และ ในคดีอาญา ` +
    `ในความผิดฐานยักยอกทรัพย์ ตามประมวลกฎหมายอาญา ซึ่งมีโทษ` +
    `จำคุกไม่เกิน 3 ปี หรือปรับไม่เกิน 60,000 บาท หรือทั้งจำทั้งปรับ ` +
    `ตามที่ระบุไว้ในสัญญาข้อ 13 และ ข้อ 21`;
  write(p5, 4);

  // ── Paragraph 6: coordinator contact ────────────────────────────────────
  const coord = data.coordinator;
  if (coord) {
    // Mixed-weight paragraph — manually compose to bold name + phone
    const prefix = `     หากท่านมีข้อสงสัยหรือประสงค์จะนัดหมายส่งคืนเครื่อง โปรดติดต่อ `;
    const nameBold = `คุณ ${coord.name}`;
    const middle = ` โทร `;
    const phoneBold = coord.phone;
    const suffix = ` โดยด่วน`;

    // First attempt: render on single line if it fits, else fall back to plain
    const fullText = `${prefix}${nameBold}${middle}${phoneBold}${suffix}`;
    const wraps = doc.splitTextToSize(fullText, CONTENT_W);
    if (wraps.length === 1) {
      let xCursor = MARGIN;
      doc.setFont(PDF_FONT_FAMILY, 'normal');
      doc.text(prefix, xCursor, y);
      xCursor += doc.getTextWidth(prefix);
      doc.setFont(PDF_FONT_FAMILY, 'bold');
      doc.text(nameBold, xCursor, y);
      xCursor += doc.getTextWidth(nameBold);
      doc.setFont(PDF_FONT_FAMILY, 'normal');
      doc.text(middle, xCursor, y);
      xCursor += doc.getTextWidth(middle);
      doc.setFont(PDF_FONT_FAMILY, 'bold');
      doc.text(phoneBold, xCursor, y);
      xCursor += doc.getTextWidth(phoneBold);
      doc.setFont(PDF_FONT_FAMILY, 'normal');
      doc.text(suffix, xCursor, y);
      y += lineH + 4;
    } else {
      write(fullText, 4);
    }
  } else if (data.company.phone) {
    write(
      `     หากท่านมีข้อสงสัย โปรดติดต่อบริษัทฯ ได้ที่หมายเลขโทรศัพท์ ` +
        `${data.company.phone} โดยด่วน`,
      4,
    );
  }

  // ── Closing (bold, slightly emphasised) ─────────────────────────────────
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  write('     จึงเรียนมาเพื่อโปรดดำเนินการ', 4);
  doc.setFont(PDF_FONT_FAMILY, 'normal');

  return y;
}

/**
 * Renders the closing "ขอแสดงความนับถือ" + signature block.
 *
 * Layout matches the reference letterhead:
 *   - center-aligned (slightly right of page center)
 *   - "ขอแสดงความนับถือ"
 *   - signature image OR dotted placeholder line "(...........................................)"
 *   - "[ ชื่อกรรมการ ]"
 *   - (optional position)
 *   - company name
 */
function signatureBlock(
  doc: jsPDF,
  data: LetterTemplateData,
  yStart: number,
  signatureDataUrl: string | null,
): void {
  // Slightly right of page center — matches printed letterhead convention
  const centerX = PAGE_W * 0.62;
  let y = yStart;

  doc.setFontSize(14);
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.text('ขอแสดงความนับถือ', centerX, y, { align: 'center' });
  y += 7;

  if (signatureDataUrl) {
    try {
      // Centered image (50mm wide × 20mm tall)
      doc.addImage(signatureDataUrl, 'PNG', centerX - 25, y, 50, 20);
    } catch {
      // Signature image is best-effort
    }
    y += 22;
  } else {
    // Dotted placeholder line — matches the printed convention
    doc.text('(...........................................)', centerX, y + 4, {
      align: 'center',
    });
    y += 9;
  }

  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.text(`[ ${data.company.directorName} ]`, centerX, y, { align: 'center' });
  y += 7;
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  if (data.company.directorPosition) {
    doc.setFontSize(13);
    doc.text(data.company.directorPosition, centerX, y, { align: 'center' });
    y += 6;
  }
  doc.setFontSize(13);
  doc.text(data.company.nameTh, centerX, y, { align: 'center' });
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
 * Build a jsPDF document for a single letter. Caller owns the returned doc —
 * useful for bulk merging (caller does doc.addPage() between letters).
 */
export async function renderLetterPdfDoc(data: LetterTemplateData): Promise<jsPDF> {
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

  // Both templates mirror the company's printed format — no centered title
  // above the body; flow is:
  //   header (logo + company + address + rule)
  //   → date (right-aligned, below rule)
  //   → "เรื่อง:" subject line
  //   → "เรียน" + "อ้างถึง" (addressBlock)
  //   → body
  //   → signature
  let y = MARGIN + 32; // first content y, below the rule

  // Date right-aligned (matches reference: date sits alone above the subject)
  doc.setFontSize(14);
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.text(
    `วันที่ ${formatThaiDate(data.letterDate)}`,
    PAGE_W - MARGIN,
    y,
    { align: 'right' },
  );
  y += 10;

  const subjectMap: Record<LetterTemplateData['letterType'], string> = {
    RETURN_DEVICE_45D:
      'เรื่อง  แจ้งเตือนให้ชำระค่าเช่าซื้อที่ค้างชำระ และ/หรือ ส่งมอบโทรศัพท์มือถือที่เช่าซื้อคืน',
    CONTRACT_TERMINATION_60D:
      'เรื่อง  บอกเลิกสัญญาเช่าซื้อ และขอให้ส่งคืนทรัพย์สินที่เช่าซื้อพร้อมชำระหนี้ค้างชำระ',
  };

  doc.setFont(PDF_FONT_FAMILY, 'bold');
  const subjectLines = doc.splitTextToSize(subjectMap[data.letterType], CONTENT_W);
  doc.text(subjectLines, MARGIN, y);
  y += subjectLines.length * 7 + 4;
  doc.setFont(PDF_FONT_FAMILY, 'normal');

  y = addressBlock(doc, data, y);

  y =
    data.letterType === 'RETURN_DEVICE_45D'
      ? bodyReturnDevice45D(doc, data, y)
      : bodyContractTermination60D(doc, data, y);

  signatureBlock(doc, data, y + 8, signatureDataUrl);
  footerBlock(doc, data);

  return doc;
}

/**
 * Wrapper that renders a single letter and returns a Blob — preserves the
 * original API used by per-row preview.
 *
 * @example
 * const blob = await renderLetterPdf(data);
 * const url = URL.createObjectURL(blob);
 * window.open(url);
 */
export async function renderLetterPdf(data: LetterTemplateData): Promise<Blob> {
  const doc = await renderLetterPdfDoc(data);
  return doc.output('blob');
}
