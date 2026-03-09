// PDF Generator using jspdf + jspdf-autotable
// Uses Sarabun font embedded for Thai text support
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Template, Block } from '@/types/template';
import { renderVariables, buildSampleContext } from '@/utils/templateRenderer';
import { AVAILABLE_VARIABLES } from '@/constants/variables';
import { formatDateMedium, formatNumberDecimal } from '@/utils/formatters';

// Cache font base64 data at module level so it persists across doc instances
const fontCache: Record<string, string> = {};

async function loadSarabunFont(doc: jsPDF) {
  // Fetch and cache font data if not already cached
  if (Object.keys(fontCache).length === 0) {
    const loadFont = async (url: string, fontName: string) => {
      try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        fontCache[fontName] = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      } catch (err) {
        console.warn(`Failed to load font ${fontName}:`, err);
      }
    };

    await Promise.all([
      loadFont('/fonts/Sarabun-Regular.ttf', 'Sarabun-Regular'),
      loadFont('/fonts/Sarabun-Bold.ttf', 'Sarabun-Bold'),
      loadFont('/fonts/Sarabun-Light.ttf', 'Sarabun-Light'),
    ]);
  }

  // Register cached fonts on this doc instance
  const styles: Record<string, string> = {
    'Sarabun-Regular': 'normal',
    'Sarabun-Bold': 'bold',
    'Sarabun-Light': 'light',
  };
  for (const [fontName, base64] of Object.entries(fontCache)) {
    doc.addFileToVFS(`${fontName}.ttf`, base64);
    doc.addFont(`${fontName}.ttf`, 'Sarabun', styles[fontName] ?? 'normal');
  }
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

  await loadSarabunFont(doc);
  doc.setFont('Sarabun', 'normal');

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
        doc.setFont('Sarabun', 'bold');
        doc.text('BESTCHOICEPHONE Co., Ltd.', pageWidth / 2, y, { align: 'center' });
        y += 6;
        doc.setFont('Sarabun', 'normal');
      }
    }
  }

  function addFooter() {
    const footerY = pageHeight - margin.bottom + 5;
    doc.setFontSize(settings.fontSize.footer);
    doc.setFont('Sarabun', 'normal');
    doc.setTextColor(150);
    doc.text(settings.footerText, margin.left, footerY);
    if (settings.showPageNumber) {
      const pageText = settings.pageNumberFormat
        .replace('{page}', String(pageNum))
        .replace('{total}', String(totalPages));
      doc.text(pageText, pageWidth - margin.right, footerY, { align: 'right' });
    }
    doc.setTextColor(0);
  }

  function addText(text: string, fontSize: number, options?: { bold?: boolean; align?: 'left' | 'center' | 'right'; indent?: number }) {
    const { bold = false, align = 'left', indent = 0 } = options || {};
    doc.setFontSize(fontSize);
    doc.setFont('Sarabun', bold ? 'bold' : 'normal');

    const effectiveWidth = contentWidth - indent;
    const x = margin.left + indent;
    const cleanText = stripBold(text);
    const lines = doc.splitTextToSize(cleanText, effectiveWidth);

    for (const line of lines) {
      checkPageBreak(fontSize * 0.45);
      if (align === 'center') {
        doc.text(line, pageWidth / 2, y, { align: 'center' });
      } else if (align === 'right') {
        doc.text(line, pageWidth - margin.right, y, { align: 'right' });
      } else {
        doc.text(line, x, y);
      }
      y += fontSize * 0.45;
    }
    y += 1;
  }

  // Letterhead
  if (settings.letterhead === 'bestchoice') {
    doc.setFontSize(14);
    doc.setFont('Sarabun', 'bold');
    doc.text('BESTCHOICEPHONE Co., Ltd.', pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.setFontSize(9);
    doc.setFont('Sarabun', 'normal');
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
  for (const block of blocks) {
    const resolved = renderVariables(block.content, ctx);

    switch (block.type) {
      case 'contract-header':
        addText(resolved, 13);
        break;

      case 'heading':
        y += 2;
        addText(resolved, settings.fontSize.heading, { bold: true, align: 'center' });
        y += 2;
        break;

      case 'subheading':
        y += 1;
        addText(resolved, 15, { bold: true });
        break;

      case 'paragraph':
      case 'party-info':
      case 'product-info':
      case 'agreement':
        addText(resolved, settings.fontSize.body, { indent: 8 });
        break;

      case 'emergency-contacts': {
        const contacts = ctx['EMERGENCY_CONTACTS'] as any[];
        // First line
        const firstLine = block.content.split('\n')[0] || '';
        addText(renderVariables(firstLine, ctx), settings.fontSize.body);
        contacts.forEach((c, i) => {
          addText(`${i + 1}. ชื่อ-นามสกุล ${c.NAME}       เบอร์โทรศัพท์ ${c.TEL}       ความสัมพันธ์ ${c.RELATION}`, settings.fontSize.body, { indent: 8 });
        });
        break;
      }

      case 'clause': {
        y += 1;
        addText(`ข้อ ${block.clauseNumber} ${block.clauseTitle || ''}`, settings.fontSize.body, { bold: true });
        addText(resolved, settings.fontSize.body, { indent: 8 });
        if (block.subItems) {
          for (const item of block.subItems) {
            const resolvedItem = renderVariables(item, ctx);
            addText(resolvedItem, 13, { indent: 12 });
          }
        }
        break;
      }

      case 'payment-table': {
        checkPageBreak(80);
        const installments = ctx['INSTALLMENTS'] as any[];
        autoTable(doc, {
          startY: y,
          head: [['งวดที่', 'วันที่ครบกำหนดชำระ', 'จำนวนเงิน']],
          body: installments.map(inst => [
            String(inst.NO),
            formatDateMedium(inst.DUE_DATE),
            formatNumberDecimal(inst.AMOUNT),
          ]),
          margin: { left: margin.left, right: margin.right },
          styles: {
            font: 'Sarabun',
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
        checkPageBreak(60);
        y += 8;
        const sigs = [
          ['ผู้ให้เช่าซื้อ', 'ผู้เช่าซื้อ'],
          ['พยาน', 'พยาน'],
        ];
        for (const row of sigs) {
          const colWidth = contentWidth / 2;
          for (let c = 0; c < 2; c++) {
            const x = margin.left + c * colWidth + colWidth / 2;
            doc.setFontSize(13);
            doc.setFont('Sarabun', 'normal');
            doc.text(`ลงชื่อ..................................................${row[c]}`, x, y, { align: 'center' });
            doc.text(`(${' '.repeat(40)})`, x, y + 6, { align: 'center' });
          }
          y += 18;
        }
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

      case 'attachment-list': {
        const lines = resolved.split('\n');
        if (lines[0]) addText(lines[0], settings.fontSize.body, { bold: true });
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim()) addText(lines[i], settings.fontSize.body, { indent: 4 });
        }
        break;
      }

      case 'column':
      case 'column-vertical': {
        const cols = resolved.split('||').map(s => s.trim());
        const colWidth = contentWidth / 2;
        doc.setFontSize(settings.fontSize.body);
        doc.setFont('Sarabun', 'normal');
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
        addText(resolved, settings.fontSize.body, { indent: 8 });
        break;

      default:
        addText(resolved, settings.fontSize.body);
    }
  }

  // Final footer
  addFooter();

  return doc.output('blob');
}
