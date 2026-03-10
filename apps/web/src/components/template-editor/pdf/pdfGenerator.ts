// PDF Generator using jspdf + jspdf-autotable
// Uses TH Sarabun PSK font embedded for Thai text support
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Template } from '@/types/template';
import { renderVariables, buildSampleContext } from '@/utils/templateRenderer';
import { AVAILABLE_VARIABLES } from '@/constants/variables';
import { formatDateMedium, formatNumberDecimal } from '@/utils/formatters';

const PDF_FONT_FAMILY = 'THSarabunPSK';

// Cache font base64 data at module level so it persists across doc instances
const fontCache: Record<string, string> = {};

async function loadThaiFont(doc: jsPDF) {
  // Fetch and cache font data if not already cached
  if (Object.keys(fontCache).length === 0) {
    const loadFont = async (url: string, fontName: string) => {
      try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        // Convert in chunks to avoid "Maximum call stack size exceeded" on large fonts
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        fontCache[fontName] = btoa(binary);
      } catch (err) {
        console.warn(`Failed to load font ${fontName}:`, err);
      }
    };

    await Promise.all([
      loadFont('/fonts/THSarabunPSK-Regular.ttf', 'THSarabunPSK-Regular'),
      loadFont('/fonts/THSarabunPSK-Bold.ttf', 'THSarabunPSK-Bold'),
    ]);
  }

  // Register cached fonts on this doc instance
  const styles: Record<string, string> = {
    'THSarabunPSK-Regular': 'normal',
    'THSarabunPSK-Bold': 'bold',
  };
  for (const [fontName, base64] of Object.entries(fontCache)) {
    doc.addFileToVFS(`${fontName}.ttf`, base64);
    doc.addFont(`${fontName}.ttf`, PDF_FONT_FAMILY, styles[fontName] ?? 'normal');
  }
}

// ---- Rich text segment types ----
interface TextSegment {
  text: string;
  bold: boolean;
  underline: boolean;
}

/** Parse HTML into styled text segments, splitting on <strong>/<b>/<u> tags */
function parseHtmlSegments(html: string): TextSegment[][] {
  // First split into paragraphs by block-level tags
  const paragraphs = html
    .replace(/<\/(?:p|div|li)>/gi, '\n<PARA_BREAK>\n')
    .replace(/<br\s*\/?>/gi, '\n<PARA_BREAK>\n')
    .split('<PARA_BREAK>')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return paragraphs.map(para => {
    const segments: TextSegment[] = [];
    let bold = false;
    let underline = false;
    let buffer = '';

    // Simple state-machine parser for inline tags
    let i = 0;
    while (i < para.length) {
      if (para[i] === '<') {
        const tagEnd = para.indexOf('>', i);
        if (tagEnd === -1) { buffer += para[i]; i++; continue; }
        const tag = para.substring(i, tagEnd + 1);
        const tagLower = tag.toLowerCase();

        // Flush buffer before style change
        if (buffer) { segments.push({ text: buffer, bold, underline }); buffer = ''; }

        if (tagLower === '<strong>' || tagLower === '<b>') { bold = true; }
        else if (tagLower === '</strong>' || tagLower === '</b>') { bold = false; }
        else if (tagLower === '<u>') { underline = true; }
        else if (tagLower === '</u>') { underline = false; }
        // Skip other tags (strip them)

        i = tagEnd + 1;
      } else {
        buffer += para[i];
        i++;
      }
    }
    if (buffer) segments.push({ text: buffer, bold, underline });
    return segments;
  });
}

/** Check if content contains HTML tags */
function isHtmlContent(content: string): boolean {
  return /<\/?(?:p|div|span|br|h[1-6]|ul|ol|li|strong|em|u|s|mark|blockquote|a|table|tr|td|th|thead|tbody|img|b)\b[^>]*\/?>/i.test(content);
}

// Strip HTML tags for plain text rendering, preserving paragraph breaks
function stripHtml(html: string): string {
  return html
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();
}

// Strip **bold** markers for plain text
function stripBold(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1');
}

export async function generatePDF(template: Template): Promise<Blob> {
  const ctx = buildSampleContext(AVAILABLE_VARIABLES);
  const { settings, blocks } = template;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  await loadThaiFont(doc);
  doc.setFont(PDF_FONT_FAMILY, 'normal');

  const margin = settings.margins;
  const pageWidth = 210;
  const pageHeight = 297;
  const contentWidth = pageWidth - margin.left - margin.right;
  let y = margin.top;
  let pageNum = 1;
  const totalPages = 6; // estimate

  function checkPageBreak(neededHeight: number) {
    if (y + neededHeight > pageHeight - margin.bottom - 10) {
      addFooter();
      doc.addPage();
      pageNum++;
      y = margin.top;
      // Add letterhead on new page if needed
      if (settings.letterhead === 'bestchoice') {
        doc.setFontSize(10);
        doc.setFont(PDF_FONT_FAMILY, 'bold');
        doc.text('BESTCHOICEPHONE Co., Ltd.', pageWidth / 2, y, { align: 'center' });
        y += 6;
        doc.setFont(PDF_FONT_FAMILY, 'normal');
      }
    }
  }

  function addFooter() {
    const footerY = pageHeight - margin.bottom + 5;
    doc.setFontSize(settings.fontSize.footer);
    doc.setFont(PDF_FONT_FAMILY, 'normal');
    doc.setTextColor(150);
    const resolvedFooter = renderVariables(settings.footerText, ctx);
    doc.text(resolvedFooter, margin.left, footerY);
    if (settings.showPageNumber) {
      const pageText = settings.pageNumberFormat
        .replace('{page}', String(pageNum))
        .replace('{total}', String(totalPages));
      doc.text(pageText, pageWidth - margin.right, footerY, { align: 'right' });
    }
    doc.setTextColor(0);
  }

  /** Plain text addText — used for non-HTML content */
  function addText(text: string, fontSize: number, options?: { bold?: boolean; align?: 'left' | 'center' | 'right'; indent?: number; firstLineIndent?: number }) {
    const { bold = false, align = 'left', indent = 0, firstLineIndent } = options || {};
    doc.setFontSize(fontSize);
    doc.setFont(PDF_FONT_FAMILY, bold ? 'bold' : 'normal');

    const effectiveWidth = contentWidth - indent;
    const x = margin.left + indent;
    const cleanText = stripBold(text);
    const lines = doc.splitTextToSize(cleanText, effectiveWidth);

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      checkPageBreak(fontSize * 0.45);
      // First-line indent (like CSS textIndent) — only on the very first line
      const extraIndent = (li === 0 && firstLineIndent) ? firstLineIndent : 0;
      if (align === 'center') {
        doc.text(line, pageWidth / 2, y, { align: 'center' });
      } else if (align === 'right') {
        doc.text(line, pageWidth - margin.right, y, { align: 'right' });
      } else {
        doc.text(line, x + extraIndent, y);
      }
      y += fontSize * 0.45;
    }
    y += 1;
  }

  /**
   * Render rich text segments with inline bold/underline support.
   * Handles word-wrapping across segments.
   */
  function addRichText(segments: TextSegment[], fontSize: number, options?: { indent?: number; firstLineIndent?: number; align?: 'left' | 'center' | 'right' }) {
    const { indent = 0, firstLineIndent, align = 'left' } = options || {};
    const lineHeight = fontSize * 0.45;
    const effectiveWidth = contentWidth - indent;
    const baseX = margin.left + indent;

    doc.setFontSize(fontSize);

    // Build word-level tokens with style info
    interface WordToken { text: string; bold: boolean; underline: boolean; width: number; isSpace: boolean }
    const tokens: WordToken[] = [];
    for (const seg of segments) {
      doc.setFont(PDF_FONT_FAMILY, seg.bold ? 'bold' : 'normal');
      // Split on spaces but keep spaces as separate tokens for accurate wrapping
      const parts = seg.text.split(/( +)/);
      for (const part of parts) {
        if (part.length === 0) continue;
        tokens.push({
          text: part,
          bold: seg.bold,
          underline: seg.underline,
          width: doc.getTextWidth(part),
          isSpace: /^\s+$/.test(part),
        });
      }
    }

    // Group tokens into lines based on available width
    type LineData = WordToken[];
    const lines: LineData[] = [];
    let currentLine: WordToken[] = [];
    let currentLineWidth = 0;
    let isFirstLine = true;
    const getAvailWidth = () => effectiveWidth - (isFirstLine && firstLineIndent ? firstLineIndent : 0);

    for (const token of tokens) {
      if (currentLineWidth + token.width > getAvailWidth() && currentLine.length > 0 && !token.isSpace) {
        // Trim trailing spaces from current line
        while (currentLine.length > 0 && currentLine[currentLine.length - 1].isSpace) {
          currentLine.pop();
        }
        lines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
        isFirstLine = false;
      }
      currentLine.push(token);
      currentLineWidth += token.width;
    }
    if (currentLine.length > 0) {
      // Trim trailing spaces
      while (currentLine.length > 0 && currentLine[currentLine.length - 1].isSpace) {
        currentLine.pop();
      }
      lines.push(currentLine);
    }

    // Render each line
    isFirstLine = true;
    for (const lineTokens of lines) {
      checkPageBreak(lineHeight);
      const extraIndent = (isFirstLine && firstLineIndent) ? firstLineIndent : 0;

      if (align === 'center') {
        // For centered text, calculate total width and offset
        const totalWidth = lineTokens.reduce((sum, t) => sum + t.width, 0);
        let cx = (pageWidth - totalWidth) / 2;
        for (const token of lineTokens) {
          doc.setFont(PDF_FONT_FAMILY, token.bold ? 'bold' : 'normal');
          doc.text(token.text, cx, y);
          if (token.underline && !token.isSpace) {
            const tw = doc.getTextWidth(token.text);
            doc.setDrawColor(0);
            doc.line(cx, y + 0.5, cx + tw, y + 0.5);
          }
          cx += token.width;
        }
      } else {
        let cx = baseX + extraIndent;
        for (const token of lineTokens) {
          doc.setFont(PDF_FONT_FAMILY, token.bold ? 'bold' : 'normal');
          doc.text(token.text, cx, y);
          if (token.underline && !token.isSpace) {
            const tw = doc.getTextWidth(token.text);
            doc.setDrawColor(0);
            doc.line(cx, y + 0.5, cx + tw, y + 0.5);
          }
          cx += token.width;
        }
      }

      y += lineHeight;
      isFirstLine = false;
    }
    y += 1;
  }

  /**
   * Smart render — detects HTML content and uses rich text rendering with inline bold.
   * Falls back to plain text addText for non-HTML content.
   */
  function addContent(content: string, fontSize: number, options?: { bold?: boolean; indent?: number; firstLineIndent?: number; align?: 'left' | 'center' | 'right' }) {
    if (isHtmlContent(content)) {
      // Resolve variables in the HTML before parsing
      const resolvedHtml = renderVariables(content, ctx);
      const paragraphs = parseHtmlSegments(resolvedHtml);
      for (const segments of paragraphs) {
        if (segments.length === 0 || (segments.length === 1 && !segments[0].text.trim())) continue;
        addRichText(segments, fontSize, {
          indent: options?.indent,
          firstLineIndent: options?.firstLineIndent,
          align: options?.align,
        });
      }
    } else {
      // Plain text path
      const plainContent = stripHtml(content);
      const resolved = renderVariables(plainContent, ctx);
      const paragraphs = resolved.split('\n').filter(l => l.trim());
      for (const para of paragraphs) {
        addText(para, fontSize, options);
      }
    }
  }

  // Letterhead
  if (settings.letterhead === 'bestchoice') {
    doc.setFontSize(14);
    doc.setFont(PDF_FONT_FAMILY, 'bold');
    doc.text('BESTCHOICEPHONE Co., Ltd.', pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.setFontSize(9);
    doc.setFont(PDF_FONT_FAMILY, 'normal');
    doc.setTextColor(100);
    doc.text('บริษัท เบสท์ช้อยส์โฟน จำกัด | เลขประจำตัวผู้เสียภาษี 0165568000050', pageWidth / 2, y, { align: 'center' });
    y += 4;
    doc.text('456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000', pageWidth / 2, y, { align: 'center' });
    y += 3;
    doc.setTextColor(0);
    doc.setDrawColor(200);
    doc.line(margin.left, y, pageWidth - margin.right, y);
    y += 5;
  }

  // Render blocks
  let clauseCounter = 0;
  for (const block of blocks) {
    const plainContent = stripHtml(block.content);
    const resolved = renderVariables(plainContent, ctx);

    switch (block.type) {
      case 'contract-header': {
        // Collapse newlines to space (preview renders as single line)
        const headerText = resolved.replace(/\n+/g, ' ').trim();
        let leftText: string;
        let rightText: string;
        if (headerText.includes('||')) {
          const parts = headerText.split('||').map(s => s.trim());
          leftText = parts[0];
          rightText = parts[1] || '';
        } else {
          // Legacy: split on "วันที่ทำสัญญา"
          const splitIdx = headerText.indexOf('วันที่ทำสัญญา');
          if (splitIdx > 0) {
            leftText = headerText.substring(0, splitIdx).trim();
            rightText = headerText.substring(splitIdx).trim();
          } else {
            leftText = headerText;
            rightText = '';
          }
        }
        doc.setFontSize(13);
        doc.setFont(PDF_FONT_FAMILY, 'normal');
        doc.text(stripBold(leftText), margin.left, y);
        if (rightText) {
          doc.text(stripBold(rightText), pageWidth - margin.right, y, { align: 'right' });
        }
        y += 13 * 0.45 + 1;
        break;
      }

      case 'heading':
        y += 2;
        addContent(block.content, settings.fontSize.heading, { bold: true, align: 'center' });
        y += 2;
        break;

      case 'subheading':
        y += 1;
        addContent(block.content, 15, { bold: true });
        break;

      case 'paragraph':
      case 'party-info':
      case 'product-info':
      case 'agreement':
        addContent(block.content, settings.fontSize.body, { firstLineIndent: 8 });
        break;

      case 'emergency-contacts': {
        const contacts = ctx['EMERGENCY_CONTACTS'] as any[];
        // First line — use stripped content for HTML compatibility
        const firstLine = plainContent.split('\n')[0] || '';
        addText(renderVariables(firstLine, ctx), settings.fontSize.body);
        contacts.forEach((c, i) => {
          addText(`${i + 1}. ชื่อ-นามสกุล ${c.NAME}       เบอร์โทรศัพท์ ${c.TEL}       ความสัมพันธ์ ${c.RELATION}`, settings.fontSize.body, { indent: 8 });
        });
        break;
      }

      case 'clause': {
        clauseCounter++;
        y += 1;
        addText(`ข้อ ${clauseCounter} ${block.clauseTitle || ''}`, settings.fontSize.body, { bold: true });

        if (isHtmlContent(block.content)) {
          // Rich text clause — render with inline bold support
          addContent(block.content, settings.fontSize.body, { firstLineIndent: 8 });
        } else {
          // Plain text clause — split by newlines for sub-items
          const clauseLines = resolved.split('\n').filter(l => l.trim());
          if (clauseLines[0]) addText(clauseLines[0], settings.fontSize.body, { firstLineIndent: 8 });
          for (let i = 1; i < clauseLines.length; i++) {
            const line = clauseLines[i].trim();
            if (line) {
              // Auto-number sub-items if they don't already have a number prefix
              const displayLine = /^\d+[).]\s/.test(line) ? line : `${i}) ${line}`;
              addText(displayLine, 13, { indent: 12 });
            }
          }
        }
        break;
      }

      case 'payment-table': {
        checkPageBreak(80);
        const installments = ctx['INSTALLMENTS'] as any[];
        const tableWidth = contentWidth * 0.75;
        const tableMarginLeft = margin.left + (contentWidth - tableWidth) / 2;
        autoTable(doc, {
          startY: y,
          head: [['งวดที่', 'วันที่ครบกำหนดชำระ', 'จำนวนเงิน']],
          body: installments.map(inst => [
            String(inst.NO),
            formatDateMedium(inst.DUE_DATE),
            formatNumberDecimal(inst.AMOUNT),
          ]),
          tableWidth: tableWidth,
          margin: { left: tableMarginLeft, right: margin.right },
          styles: {
            font: PDF_FONT_FAMILY,
            fontSize: 12,
            cellPadding: 2,
          },
          headStyles: {
            fillColor: [240, 240, 240],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
          },
          columnStyles: {
            0: { halign: 'center', cellWidth: 20 },
            1: { halign: 'center' },
            2: { halign: 'right', cellWidth: 35 },
          },
        });
        y = (doc as any).lastAutoTable.finalY + 5;
        break;
      }

      case 'signature-block': {
        checkPageBreak(70);
        y += 8;
        const sigFontSize = settings.fontSize.body;
        const colWidth = contentWidth / 2;
        const customerName = String(ctx['CUSTOMER.FULLNAME'] || '...................................');
        const managerName = 'เอกนรินทร์ คงเดช';

        // Row 1: ผู้ให้เช่าซื้อ (left) + ผู้เช่าซื้อ (right)
        doc.setFontSize(sigFontSize);
        doc.setFont(PDF_FONT_FAMILY, 'normal');

        // ผู้ให้เช่าซื้อ
        const leftX = margin.left + colWidth / 2;
        doc.text('ลงชื่อ..................................................ผู้ให้เช่าซื้อ', leftX, y, { align: 'center' });
        doc.text(`( ${managerName} )`, leftX, y + 6, { align: 'center' });
        doc.setFontSize(sigFontSize - 2);
        doc.setTextColor(100);
        doc.text('ผู้จัดการ บริษัท เบสท์ช้อยส์โฟน จำกัด', leftX, y + 11, { align: 'center' });
        doc.setTextColor(0);

        // ผู้เช่าซื้อ
        const rightX = margin.left + colWidth + colWidth / 2;
        doc.setFontSize(sigFontSize);
        doc.text('ลงชื่อ..................................................ผู้เช่าซื้อ', rightX, y, { align: 'center' });
        doc.text(`( ${customerName} )`, rightX, y + 6, { align: 'center' });

        y += 22;

        // Row 2: พยาน x 2
        doc.setFontSize(sigFontSize);
        for (let c = 0; c < 2; c++) {
          const x = margin.left + c * colWidth + colWidth / 2;
          doc.text('ลงชื่อ..................................................พยาน', x, y, { align: 'center' });
          doc.text(`(${' '.repeat(40)})`, x, y + 6, { align: 'center' });
        }
        y += 18;
        break;
      }

      case 'photo-attachment': {
        checkPageBreak(150);
        y += 3;
        addText('รูปถ่ายโทรศัพท์แนบท้ายสัญญา', 15, { bold: true, align: 'center' });
        y += 3;
        // Draw 2x3 grid of photo placeholders
        const photoW = (contentWidth - 10) / 2;
        const photoH = 35;
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 2; col++) {
            const px = margin.left + col * (photoW + 10);
            const py = y + row * (photoH + 5);
            doc.setDrawColor(180);
            doc.setLineDashPattern([2, 2], 0);
            doc.rect(px, py, photoW, photoH);
            doc.setLineDashPattern([], 0);
            doc.setFontSize(10);
            doc.setTextColor(150);
            doc.text(`รูปภาพ ${row * 2 + col + 1}`, px + photoW / 2, py + photoH / 2, { align: 'center' });
            doc.setTextColor(0);
          }
        }
        y += 3 * (photoH + 5) + 5;
        // Footer
        addText('ชื่อ .............................. ผู้เช่าซื้อ', 13, { align: 'center' });
        addText('วันที่ .......... เดือน .................. พ.ศ ............', 13, { align: 'center' });
        break;
      }

      case 'attachment-list':
        addContent(block.content, settings.fontSize.body, { bold: false });
        break;

      case 'column':
      case 'column-vertical': {
        // Collapse newlines from stripHtml before splitting columns
        const cols = resolved.replace(/\n+/g, ' ').split('||').map(s => s.trim());
        const colWidth = contentWidth / 2;
        doc.setFontSize(settings.fontSize.body);
        doc.setFont(PDF_FONT_FAMILY, 'normal');
        for (let c = 0; c < Math.min(cols.length, 2); c++) {
          const x = margin.left + c * colWidth;
          const lines = doc.splitTextToSize(stripBold(cols[c]), colWidth - 5);
          let colY = y;
          for (const line of lines) {
            doc.text(line, x, colY);
            colY += settings.fontSize.body * 0.45;
          }
        }
        y += settings.fontSize.body * 0.45 * 3;
        break;
      }

      case 'numbered':
        addContent(block.content, settings.fontSize.body, { indent: 8 });
        break;

      default:
        addContent(block.content, settings.fontSize.body);
    }
  }

  // Final footer
  addFooter();

  return doc.output('blob');
}
