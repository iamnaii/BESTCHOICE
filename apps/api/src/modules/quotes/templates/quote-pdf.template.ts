import { EMBEDDED_FONT_FACES } from '../../../assets/fonts/embedded-fonts';

/**
 * SP5 — ใบเสนอราคา (Quote) HTML template for puppeteer-rendered PDF.
 *
 * Mirrors the receipts/other-income receipt visual language:
 * - Noto Sans Thai (variable) + Sriracha embedded fonts
 * - Emerald primary, zinc neutrals, A4 page
 * - Header (logo placeholder + doc title) → parties → items → totals → footer
 *
 * Pure formatting function — no DB or network. Pass a fully-hydrated `data`
 * object from `QuotesService.buildPdfData`.
 */

export interface QuotePdfItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface QuotePdfData {
  quoteNumber: string;
  status: string;
  issueDate: Date;
  validUntil: Date;
  companyName: string;
  companyTaxId?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  branchName: string;
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  items: QuotePdfItem[];
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
  notes?: string | null;
  createdByName: string;
}

function fmt(amount: number): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderQuoteHtml(data: QuotePdfData): string {
  const itemRows = data.items
    .map(
      (item, idx) => `
      <tr>
        <td class="num">${idx + 1}</td>
        <td>${escapeHtml(item.description)}</td>
        <td class="num">${item.quantity}</td>
        <td class="money">${fmt(item.unitPrice)}</td>
        <td class="money">${fmt(item.amount)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบเสนอราคา ${escapeHtml(data.quoteNumber)}</title>
  <style>
    ${EMBEDDED_FONT_FACES}
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --emerald-50:#ecfdf5; --emerald-100:#d1fae5; --emerald-600:#059669; --emerald-700:#047857; --emerald-800:#065f46;
      --zinc-100:#f4f4f5; --zinc-200:#e4e4e7; --zinc-300:#d4d4d8; --zinc-400:#a1a1aa;
      --zinc-500:#71717a; --zinc-600:#52525b; --zinc-700:#3f3f46; --zinc-900:#18181b;
    }
    body {
      font-family: 'Noto Sans Thai', 'IBM Plex Sans Thai', system-ui, -apple-system, sans-serif;
      color: var(--zinc-900);
      font-size: 10pt;
      line-height: 1.5;
      padding: 14mm 14mm 12mm;
    }
    .header {
      display:flex; justify-content:space-between; align-items:flex-start;
      padding-bottom:12px; border-bottom:2px solid var(--emerald-600);
    }
    .company-block .name { font-size:14pt; font-weight:700; color:var(--zinc-900); }
    .company-block .meta { font-size:9pt; color:var(--zinc-600); margin-top:2px; }
    .doc-title {
      font-size:22pt; font-weight:700; color:var(--emerald-700);
      line-height:1; text-align:right; letter-spacing:-0.01em;
    }
    .doc-subtitle { font-size:9pt; color:var(--zinc-500); text-align:right; margin-top:4px; }

    .meta-grid {
      display:grid; grid-template-columns: 1fr 1fr; gap:16px;
      padding:16px 0; border-bottom:1px solid var(--zinc-200);
    }
    .meta-section .heading {
      font-size:9pt; font-weight:600; color:var(--emerald-800);
      text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;
    }
    .meta-section .name { font-size:11pt; font-weight:600; color:var(--zinc-900); }
    .meta-section .line {
      font-size:9pt; color:var(--zinc-700); margin-top:2px; line-height:1.5;
    }

    .doc-meta {
      display:grid; grid-template-columns:auto 1fr; gap:6px 12px;
      margin-top:12px; font-size:9.5pt;
    }
    .doc-meta dt { color:var(--zinc-600); font-weight:600; }
    .doc-meta dd { color:var(--zinc-900); font-family:'IBM Plex Mono', ui-monospace, monospace; font-size:9pt; }

    table.items {
      width:100%; border-collapse:collapse; margin-top:18px; font-size:9.5pt;
    }
    table.items th {
      background:var(--emerald-700); color:#fff; font-weight:600;
      padding:8px 10px; text-align:left;
    }
    table.items th.num, table.items th.money { text-align:right; }
    table.items td {
      padding:9px 10px; border-bottom:1px solid var(--zinc-200);
    }
    table.items td.num, table.items td.money {
      text-align:right; font-family:'IBM Plex Mono', ui-monospace, monospace; font-size:9pt;
    }

    .totals {
      margin-top:14px; display:flex; justify-content:flex-end;
    }
    .totals-card {
      width:280px; border:1px solid var(--zinc-200); border-radius:8px;
      padding:10px 14px; background:var(--zinc-100);
    }
    .totals-row {
      display:flex; justify-content:space-between; padding:4px 0;
      font-size:9.5pt;
    }
    .totals-row.grand {
      border-top:1.5px solid var(--emerald-600); padding-top:8px; margin-top:4px;
      font-weight:700; font-size:11pt; color:var(--emerald-700);
    }
    .totals-label { color:var(--zinc-700); }
    .totals-value { font-family:'IBM Plex Mono', ui-monospace, monospace; }

    .notes {
      margin-top:16px; padding:10px 14px; background:var(--emerald-50);
      border-left:3px solid var(--emerald-600); border-radius:0 6px 6px 0;
      font-size:9pt; color:var(--zinc-700);
    }
    .notes .heading { font-weight:600; color:var(--emerald-800); margin-bottom:4px; }

    .footer {
      margin-top:32px; padding-top:14px; border-top:1px solid var(--zinc-200);
      display:grid; grid-template-columns:1fr 1fr; gap:24px; font-size:9pt; color:var(--zinc-600);
    }
    .signature-block { text-align:center; padding-top:36px; border-top:1px dashed var(--zinc-400); }
    .signature-block .label { color:var(--zinc-700); font-size:9pt; }
    .signature-block .name { color:var(--zinc-900); font-weight:600; margin-top:2px; }

    .status-badge {
      display:inline-block; padding:2px 10px; border-radius:9999px;
      font-size:8pt; font-weight:600; letter-spacing:0.05em;
      background:var(--emerald-100); color:var(--emerald-800);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-block">
      <div class="name">${escapeHtml(data.companyName)}</div>
      ${data.companyTaxId ? `<div class="meta">เลขประจำตัวผู้เสียภาษี ${escapeHtml(data.companyTaxId)}</div>` : ''}
      ${data.companyAddress ? `<div class="meta">${escapeHtml(data.companyAddress)}</div>` : ''}
      ${data.companyPhone ? `<div class="meta">โทร. ${escapeHtml(data.companyPhone)}</div>` : ''}
    </div>
    <div>
      <div class="doc-title">ใบเสนอราคา</div>
      <div class="doc-subtitle">Quotation</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-section">
      <div class="heading">เสนอราคาให้</div>
      <div class="name">${escapeHtml(data.customerName)}</div>
      ${data.customerPhone ? `<div class="line">โทร. ${escapeHtml(data.customerPhone)}</div>` : ''}
      ${data.customerAddress ? `<div class="line">${escapeHtml(data.customerAddress)}</div>` : ''}
    </div>
    <div class="meta-section">
      <dl class="doc-meta">
        <dt>เลขที่</dt><dd>${escapeHtml(data.quoteNumber)}</dd>
        <dt>วันที่</dt><dd>${fmtDate(data.issueDate)}</dd>
        <dt>ใช้ได้ถึง</dt><dd>${fmtDate(data.validUntil)}</dd>
        <dt>สาขา</dt><dd>${escapeHtml(data.branchName)}</dd>
        <dt>สถานะ</dt><dd><span class="status-badge">${escapeHtml(data.status)}</span></dd>
      </dl>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="num" style="width:6%">#</th>
        <th>รายการ</th>
        <th class="num" style="width:10%">จำนวน</th>
        <th class="money" style="width:18%">ราคา/หน่วย</th>
        <th class="money" style="width:18%">รวม</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-card">
      <div class="totals-row">
        <span class="totals-label">ยอดรวม</span>
        <span class="totals-value">${fmt(data.subtotal)}</span>
      </div>
      ${
        data.discount > 0
          ? `<div class="totals-row">
        <span class="totals-label">ส่วนลด</span>
        <span class="totals-value">-${fmt(data.discount)}</span>
      </div>`
          : ''
      }
      ${
        data.vatAmount > 0
          ? `<div class="totals-row">
        <span class="totals-label">ภาษีมูลค่าเพิ่ม</span>
        <span class="totals-value">${fmt(data.vatAmount)}</span>
      </div>`
          : ''
      }
      <div class="totals-row grand">
        <span class="totals-label">รวมทั้งสิ้น</span>
        <span class="totals-value">${fmt(data.total)} บาท</span>
      </div>
    </div>
  </div>

  ${
    data.notes
      ? `<div class="notes">
    <div class="heading">หมายเหตุ</div>
    <div>${escapeHtml(data.notes)}</div>
  </div>`
      : ''
  }

  <div class="footer">
    <div class="signature-block">
      <div class="label">ผู้เสนอราคา</div>
      <div class="name">${escapeHtml(data.createdByName)}</div>
    </div>
    <div class="signature-block">
      <div class="label">ลูกค้ารับทราบ</div>
      <div class="name">${escapeHtml(data.customerName)}</div>
    </div>
  </div>
</body>
</html>`;
}
