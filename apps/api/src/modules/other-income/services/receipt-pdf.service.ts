import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';

type DocWithItems = Prisma.OtherIncomeGetPayload<{
  include: {
    items: true;
    customer: { select: { id: true; name: true; phone: true } };
  };
}>;

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function fmtThaiDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  return `${dt.getDate()} ${THAI_MONTHS_FULL[dt.getMonth()]} ${dt.getFullYear() + 543}`;
}

function fmtMoney(v: unknown): string {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

@Injectable()
export class OtherIncomeReceiptPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(id: string): Promise<Buffer> {
    const doc = await this.prisma.otherIncome.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: { orderBy: { lineNo: 'asc' } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');

    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE' },
    });

    const html = await this.renderHtml(doc, company);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private async renderHtml(
    doc: DocWithItems,
    company: { nameTh: string; taxId: string | null; address: string | null; phone: string | null } | null,
  ): Promise<string> {

    const verifyUrl = `https://bestchoicephone.app/other-income/${doc.id}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 0,
      width: 200,
      color: { dark: '#18181b', light: '#ffffff' },
    });

    const items = (doc.items || [])
      .map(
        (it) => `
          <tr>
            <td>
              <div style="font-weight:600">${escapeHtml(it.accountName)}</div>
              <div style="font-size:10px;color:#71717a">(${escapeHtml(it.accountCode)})</div>
              ${it.description ? `<div style="font-size:10px;color:#71717a">${escapeHtml(it.description)}</div>` : ''}
            </td>
            <td style="text-align:right;font-family:monospace">${fmtMoney(it.quantity)}</td>
            <td style="text-align:right;font-family:monospace">${fmtMoney(it.unitAmount)}</td>
            <td style="text-align:center;font-size:11px">${Number(it.vatPct) > 0 ? `${it.vatPct}%` : '-'}</td>
            <td style="text-align:right;font-family:monospace">${fmtMoney(it.amountBeforeVat)}</td>
          </tr>`,
      )
      .join('');

    const firstWhtPct = doc.items?.[0]?.whtPct;
    const showVatRow = Number(doc.vatAmount) > 0;
    const showWhtRow = Number(doc.whtAmount) > 0;

    const customerName = doc.customer?.name || doc.counterpartyName || '—';

    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<title>ใบเสร็จรับเงิน ${escapeHtml(doc.docNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'Helvetica Neue', Arial, sans-serif; color: #18181b; font-size: 13px; line-height: 1.45; margin: 0; padding: 0; }
  .title-block { text-align: right; margin-bottom: 16px; }
  .title-original { font-size: 11px; color: #71717a; }
  .title-h1 { font-size: 24px; font-weight: 700; color: #059669; margin: 4px 0 0; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .seller p { margin: 0; }
  .seller .name { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .seller .subline { font-size: 11px; color: #52525b; }
  .info-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; font-size: 13px; }
  .info-box p { margin: 0 0 4px; }
  .info-box .small { font-size: 10px; color: #71717a; word-break: break-all; }
  .customer-block { border-top: 1px solid #e4e4e7; border-bottom: 1px solid #e4e4e7; padding: 12px 0; margin-bottom: 16px; }
  .customer-block .label { font-weight: 700; margin-bottom: 4px; }
  .customer-block .sub { font-size: 11px; color: #71717a; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  table.items thead tr { background: #f4f4f5; border-top: 1px solid #e4e4e7; border-bottom: 1px solid #e4e4e7; }
  table.items th { padding: 8px; text-align: left; font-weight: 600; }
  table.items th.num { text-align: right; }
  table.items th.ctr { text-align: center; }
  table.items td { padding: 8px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  .totals-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 13px; margin-bottom: 32px; }
  .totals-left p { margin: 0 0 4px; font-size: 11px; color: #52525b; }
  .totals-right > div { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .totals-right .hl { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 8px; border-radius: 4px; font-weight: 700; }
  .totals-right .wht { font-size: 11px; color: #71717a; }
  .totals-right .net { border-top: 1px solid #e4e4e7; padding-top: 4px; font-size: 11px; color: #52525b; }
  .signatures { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; text-align: center; font-size: 11px; color: #71717a; margin-top: 24px; }
  .signatures .line { border-bottom: 1px solid #d4d4d8; height: 56px; margin-bottom: 8px; }
  .signatures .stamp { border: 1px dashed #d4d4d8; height: 56px; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; border-radius: 4px; color: #a1a1aa; }
  .signatures .name { font-weight: 600; color: #18181b; }
  .qr-block { display: flex; flex-direction: column; align-items: center; margin-top: 24px; gap: 4px; }
  .qr-block img { width: 80px; height: 80px; }
  .qr-block .doc-no { font-size: 11px; color: #71717a; font-family: monospace; margin-top: 4px; }
</style>
</head>
<body>
  <div class="title-block">
    <div class="title-original">(ต้นฉบับ)</div>
    <h1 class="title-h1">ใบเสร็จรับเงิน / ใบกำกับภาษี</h1>
  </div>

  <div class="two-col">
    <div class="seller">
      <p class="name">${escapeHtml(company?.nameTh) || 'บริษัท เบสท์ช้อยส์ ไฟแนนท์ จำกัด'}</p>
      <p class="subline">เลขที่ผู้เสียภาษี: ${escapeHtml(company?.taxId) || '—'}</p>
      <p class="subline">ที่อยู่: ${escapeHtml(company?.address) || '—'}</p>
      <p class="subline">โทร: ${escapeHtml(company?.phone) || '—'}</p>
    </div>
    <div class="info-box">
      <p>เลขที่: <strong>${escapeHtml(doc.receiptNo) || escapeHtml(doc.docNumber)}</strong></p>
      <p>วันที่: ${fmtThaiDate(doc.issueDate)}</p>
      ${doc.journalEntryId ? `<p class="small">JV: ${escapeHtml(doc.journalEntryId)}</p>` : ''}
    </div>
  </div>

  <div class="customer-block">
    <p class="label">ลูกค้า / คู่ค้า:</p>
    <p>${escapeHtml(customerName)}</p>
    ${doc.counterpartyAddress ? `<p class="sub">${escapeHtml(doc.counterpartyAddress)}</p>` : ''}
    ${doc.counterpartyTaxId ? `<p class="sub">เลขผู้เสียภาษี: ${escapeHtml(doc.counterpartyTaxId)}</p>` : ''}
    ${doc.counterpartyPhone ? `<p class="sub">โทร: ${escapeHtml(doc.counterpartyPhone)}</p>` : ''}
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>รายละเอียด</th>
        <th class="num">จำนวน</th>
        <th class="num">ราคา/หน่วย</th>
        <th class="ctr">VAT</th>
        <th class="num">ก่อนภาษี</th>
      </tr>
    </thead>
    <tbody>${items}</tbody>
  </table>

  <div class="totals-grid">
    <div class="totals-left">
      <p>ช่องทางชำระ: ${escapeHtml(doc.paymentAccountCode)}</p>
      ${doc.paymentDate ? `<p>วันที่รับเงิน: ${fmtThaiDate(doc.paymentDate)}</p>` : ''}
      ${doc.customerNote ? `<p>หมายเหตุ: ${escapeHtml(doc.customerNote)}</p>` : ''}
    </div>
    <div class="totals-right">
      <div><span>รวมก่อน VAT:</span><strong style="font-family:monospace">${fmtMoney(doc.incomeGross)}</strong></div>
      ${showVatRow ? `<div><span>VAT 7%:</span><strong style="font-family:monospace">${fmtMoney(doc.vatAmount)}</strong></div>` : ''}
      <div class="hl"><span>จำนวนเงินทั้งสิ้น:</span><strong style="font-family:monospace">${fmtMoney(doc.totalAmount)} ฿</strong></div>
      ${showWhtRow ? `<div class="wht"><span>หัก ณ ที่จ่าย${firstWhtPct ? ` (${firstWhtPct}%)` : ''}:</span><span style="font-family:monospace">(${fmtMoney(doc.whtAmount)})</span></div>` : ''}
      <div class="net"><span>ยอดที่ชำระสุทธิ:</span><span style="font-family:monospace;font-weight:700">${fmtMoney(doc.amountReceived)} ฿</span></div>
    </div>
  </div>

  <div class="signatures">
    <div>
      <div class="line"></div>
      <div class="name">ผู้ออกเอกสาร</div>
      <div>ลายเซ็น / วันที่</div>
    </div>
    <div>
      <div class="stamp">ตราประทับ</div>
      <div class="name">ตราประทับ (ผู้ขาย)</div>
    </div>
    <div>
      <div class="line"></div>
      <div class="name">ผู้รับเอกสาร</div>
      <div>ลายเซ็น / วันที่</div>
    </div>
    <div>
      <div class="stamp">ตราประทับ</div>
      <div class="name">ตราประทับ (ลูกค้า)</div>
    </div>
  </div>

  <div class="qr-block">
    <img src="${qrDataUrl}" alt="QR" />
    <div class="doc-no">${escapeHtml(doc.docNumber)}</div>
  </div>
</body>
</html>`;
  }
}
