import { paperSpacingScript, PAPER_SPACING_CSS } from '@installment/shared';
import { TRANSACTION_PAGE_CSS, DOCUMENT_WEB_FONT_FACES, transactionDocumentCss } from '@installment/shared';
import { thaiBahtText } from '../../../../utils/thai-baht-text.util';
import { LEGACY_TRADE_IN_DECLARATION } from '@installment/shared';
import * as fs from 'fs';
import * as path from 'path';

/**
 * VoucherHtmlBuilder — pure presentation layer for the Trade-In payment voucher.
 *
 * Builds the self-contained inline HTML/CSS template (no external network calls)
 * + all presentation helpers (logo SVG, date/baht formatting, escaping,
 * device-label rendering). NO DI — instantiate directly.
 */
export class VoucherHtmlBuilder {
  /** Format date as Thai date "8 เมษายน 2569" (Buddhist year) */
  private formatThaiDate(d: Date): string {
    const months = [
      'มกราคม',
      'กุมภาพันธ์',
      'มีนาคม',
      'เมษายน',
      'พฤษภาคม',
      'มิถุนายน',
      'กรกฎาคม',
      'สิงหาคม',
      'กันยายน',
      'ตุลาคม',
      'พฤศจิกายน',
      'ธันวาคม',
    ];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
  }

  /** BESTCHOICE logo SVG — อ่านจาก apps/web/public/logo.svg (cached) */
  private cachedLogoSvg: string | null = null;
  private logoSvg(): string {
    if (this.cachedLogoSvg) return this.cachedLogoSvg;
    const candidates = [
      path.join(process.cwd(), 'public', 'logo.svg'),
      path.join(__dirname, '..', '..', '..', '..', '..', '..', 'public', 'logo.svg'),
      path.join(process.cwd(), '..', 'web', 'public', 'logo.svg'),
      path.join(__dirname, '..', '..', '..', '..', '..', '..', 'web', 'public', 'logo.svg'),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      const raw = fs.readFileSync(found, 'utf8');
      this.cachedLogoSvg = raw;
      return this.cachedLogoSvg;
    }
    // fallback — ถ้าหาไฟล์ไม่เจอ ใช้ text แทน (ไม่ใช่ SVG เทียม)
    this.cachedLogoSvg = `<div style="font-family:Arial,sans-serif;font-size:10pt;font-weight:800;letter-spacing:1px"><span style="color:#4D4D4D">BEST</span><span style="color:#1DA579">CHOICE</span></div>`;
    return this.cachedLogoSvg;
  }

  // ─── Helpers ──────────────────────────────────────────────
  buildDeviceLabel(t: {
    deviceBrand: string;
    deviceModel: string;
    deviceStorage: string | null;
    deviceColor: string | null;
    imei: string | null;
    serialNumber?: string | null;
    imeiMissingReason?: string | null;
    serialNumberMissingReason?: string | null;
  }): string {
    const main = [t.deviceBrand, t.deviceModel, t.deviceStorage].filter(Boolean).join(' ');
    return [main, t.deviceColor ? `สี${t.deviceColor}` : null,
      `IMEI: ${t.imei || (t.imeiMissingReason ? `ไม่มี — ${t.imeiMissingReason}` : 'ไม่ระบุ')}`,
      `Serial Number: ${t.serialNumber || (t.serialNumberMissingReason ? `ไม่มี — ${t.serialNumberMissingReason}` : 'ไม่ระบุ')}`,
    ].filter(Boolean).join('\n');
  }

  /** เลขเป็นข้อความไทย เช่น 37,673.00 → "สามหมื่นเจ็ดพันหกร้อยเจ็ดสิบสามบาทถ้วน" */
  // Thai-baht-in-words now lives in the shared thai-baht-text util (Wave 4 dedup).
  // (The old local copy broke at >= 10,000,000 — see thai-baht-text.util.spec.ts.)
  numberToThaiBahtText(num: number): string {
    return thaiBahtText(num);
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  private formatBaht(n: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ─── HTML template ────────────────────────────────────────
  buildHtml(data: {
    voucherNumber: string;
    voucherDate: Date;
    isReprint: boolean;
    company: {
      nameTh: string;
      address: string;
      taxId: string;
      phone?: string | null;
      logoUrl?: string | null;
    } | null;
    sellerName: string;
    sellerAddress: string;
    sellerPhone: string;
    sellerIdCard: string;
    sellerSignatureBase64: string | null;
    sellerDeclarationText?: string | null;
    issuerName: string;
    issuerSignatureBase64: string | null;
    deviceLabel: string;
    amount: number;
    amountText: string;
    paymentMethod: 'CASH' | 'TRANSFER' | 'TRADE_IN_CREDIT';
    creditBaseAmount?: number | null;
    creditBonusAmount?: number | null;
    transferBankName: string | null;
    transferAccountNumber: string | null;
    transferAccountName: string | null;
  }): string {
    const company = data.company ?? {
      nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      address:
        'เลขที่ 456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000',
      taxId: '0165568000050',
      phone: '063-134-6356',
      logoUrl: null,
    };

    const isCredit = data.paymentMethod === 'TRADE_IN_CREDIT';
    const title = isCredit ? 'ใบรับเครื่องเทิร์น' : 'ใบสำคัญจ่ายเงิน';
    const esc = (value: string) => this.escapeHtml(value);
    const date = this.formatThaiDate(data.voucherDate);
    const [deviceName, ...deviceDetails] = data.deviceLabel.split('\n');
    const signature = (value: string | null, label: string) =>
      value
        ? `<img src="${esc(value)}" alt="${label}" />`
        : '<span class="muted">ลงชื่อ ................................................</span>';

    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>${title} ${esc(data.voucherNumber)}</title>
  <style>
${DOCUMENT_WEB_FONT_FACES}
${TRANSACTION_PAGE_CSS}
${transactionDocumentCss('body')}
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.payment { margin-top: 2mm; }
.payment h2 { font-size: 16pt !important; color: #047857; }
.payment-row { display: grid; grid-template-columns: 40mm minmax(0,1fr); gap: 2mm; }
.credit-note { margin-top: 1mm; }
.declaration { margin-top: 2mm; border-top: 1px solid #d4dfd9; padding-top: 2mm; }
.bc-doc-approval { margin-top: 2mm; }
/* The seller declaration makes this closing block taller than half a page, so the shared
   "keep the closing together" rule pushed every amount line to a near-empty second page
   (DOC-02). Let the block paginate, but keep amount + payment and declaration + signatures
   each in one piece. */
body .bc-doc-closing { break-inside: auto; }
.bc-doc-settlement, .bc-doc-attestation { break-inside: avoid; }
.device-name { font-weight: 700; }
.device-details { color: #52645d; }
.center { text-align: center; }
${PAPER_SPACING_CSS}
</style>
</head>
<body data-bc-paper>
<div class="bc-doc-header"><div class="bc-doc-brand"><div>${this.logoSvg()}</div><p class="bc-doc-company">${esc(company.nameTh)}</p><p>${esc(company.address)}</p><p>เลขประจำตัวผู้เสียภาษี ${esc(company.taxId)}</p>${company.phone ? `<p>โทร ${esc(company.phone)}</p>` : ''}</div>
<div class="bc-doc-identity"><h1>${title}</h1><p class="bc-doc-kicker">${isCredit ? 'TRADE-IN RECEIPT' : 'PAYMENT VOUCHER'} · ${data.isReprint ? 'สำเนา / COPY' : 'ต้นฉบับ / ORIGINAL'}</p><div class="bc-doc-meta"><span>เลขที่เอกสาร</span><span>${esc(data.voucherNumber)}</span><span>วันที่</span><span>${date}</span></div></div></div>
<div class="bc-doc-parties"><div><p class="bc-doc-label">${isCredit ? 'ผู้ส่งมอบเครื่อง' : 'ผู้รับเงิน / ผู้ขาย'}</p><strong>${esc(data.sellerName)}</strong><p>${esc(data.sellerAddress)}</p></div><div class="bc-doc-kv"><span>เลขบัตรประชาชน</span><span>${esc(data.sellerIdCard)}</span><span>โทรศัพท์</span><span>${esc(data.sellerPhone)}</span></div></div>
    <table aria-label="${isCredit ? 'รายการเครื่องเทิร์น' : 'รายการจ่ายเงิน'}">
      <colgroup><col style="width:12mm"><col><col style="width:22mm"><col style="width:38mm"></colgroup>
      <thead><tr><th class="center">#</th><th>รายละเอียดเครื่อง</th><th class="center">จำนวน</th><th class="right">${isCredit ? 'มูลค่า (บาท)' : 'จำนวนเงิน (บาท)'}</th></tr></thead>
      <tbody><tr>
        <td class="center">1</td>
        <td><p class="device-name">${esc(deviceName)}</p>${deviceDetails.length ? `<p class="device-details">${esc(deviceDetails.join('\n'))}</p>` : ''}</td>
        <td class="center">1 เครื่อง</td>
        <td class="right item-amount number"><strong>${this.formatBaht(data.amount)}</strong></td>
      </tr></tbody>
    </table>

<div class="bc-doc-closing"><div class="bc-doc-settlement"><div class="bc-doc-total-grid"><div><p class="bc-doc-label">จำนวนเงินเป็นตัวอักษร</p><strong>${esc(data.amountText)}</strong></div><div class="bc-doc-grand"><span>${isCredit ? 'ยอดเครดิตที่ตกลง' : 'ยอดจ่ายสุทธิ'}</span><span>${this.formatBaht(data.amount)} บาท</span></div></div>
  <section class="payment">
    <h2 class="section-title">${isCredit ? 'การรับเครื่อง' : 'ข้อมูลการจ่ายเงิน'}</h2>
    <div class="payment-row"><span class="label">${isCredit ? 'รูปแบบการรับเครื่อง' : 'วิธีจ่ายเงิน'}</span><strong>${isCredit ? 'เครดิตเทิร์นเครื่อง' : data.paymentMethod === 'TRANSFER' ? 'โอนเงินเข้าบัญชีผู้ขาย' : 'เงินสด'}</strong></div>
    ${
      isCredit
        ? `${data.creditBaseAmount != null && data.creditBonusAmount != null ? `<p class="credit-note">มูลค่าเครื่อง ${this.formatBaht(data.creditBaseAmount)} บาท + โบนัสส่วนลด ${this.formatBaht(data.creditBonusAmount)} บาท · ใช้เต็มยอดครั้งเดียวตามเงื่อนไขรายการขาย</p>` : ''}<p class="credit-note">เอกสารนี้ยืนยันการรับเครื่อง การใช้เครดิตให้ตรวจจากใบขายหรือสัญญาที่อ้างอิงรายการนี้</p>`
        : data.paymentMethod === 'TRANSFER'
          ? `<div class="payment-row"><span class="label">ธนาคาร / เลขบัญชี</span><span>${esc(data.transferBankName || '-')} / <span class="number">${esc(data.transferAccountNumber || '-')}</span></span></div>
           <div class="payment-row"><span class="label">ชื่อบัญชีผู้รับเงิน</span><span>${esc(data.transferAccountName || '-')}</span></div>`
          : `<div class="payment-row"><span class="label">ผู้รับเงินสด</span><span>${esc(data.sellerName)}</span></div>`
    }
  </section>
</div>

<div class="bc-doc-attestation"><p class="declaration"><strong>คำรับรองผู้ขาย</strong>${data.sellerDeclarationText ? ` · ${esc(data.voucherNumber)}<br>` : ' '}${esc(data.sellerDeclarationText ?? LEGACY_TRADE_IN_DECLARATION)}</p>
  <section class="bc-doc-approval" aria-label="ลายเซ็น">
    <div class="bc-doc-signature">
      <div class="sign-space">${signature(data.issuerSignatureBase64, 'ลายเซ็นผู้ออกเอกสาร')}</div>
      <strong>${esc(data.issuerName)}</strong>
      <p class="signer-role">ผู้รับซื้อ / ผู้ออกเอกสาร</p>
      <p class="bc-doc-kicker">วันที่ ${date}</p>
    </div>
    <div class="bc-doc-signature">
      <div class="sign-space">${signature(data.sellerSignatureBase64, 'ลายเซ็นผู้ขาย')}</div>
      <strong>${esc(data.sellerName)}</strong>
      <p class="signer-role">${isCredit ? 'ผู้ส่งมอบเครื่อง' : 'ผู้รับเงิน (ผู้ขาย)'}</p>
      <p class="bc-doc-kicker">วันที่ ${date}</p>
    </div>
  </section>

<footer class="bc-doc-footer"><span>${esc(data.voucherNumber)}</span><span>ออกโดยระบบ BESTCHOICE</span></footer></div></div>
${paperSpacingScript()}
</body>
</html>`;
  }
}
