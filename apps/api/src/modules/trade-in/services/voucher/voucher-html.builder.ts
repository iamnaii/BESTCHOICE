import { thaiBahtText } from '../../../../utils/thai-baht-text.util';
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
  }): string {
    const main = [t.deviceBrand, t.deviceModel, t.deviceStorage].filter(Boolean).join(' ');
    const sub = [t.deviceColor ? `สี${t.deviceColor}` : null, t.imei ? `IMEI ${t.imei}` : null]
      .filter(Boolean)
      .join(' ');
    return sub ? `${main}\n${sub}` : main;
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
    issuerName: string;
    issuerSignatureBase64: string | null;
    deviceLabel: string;
    amount: number;
    amountText: string;
    paymentMethod: 'CASH' | 'TRANSFER' | 'TRADE_IN_CREDIT';
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
    @page {
      size: A4;
      margin: 15mm 17mm;
      @bottom-center {
        content: "${data.isReprint ? 'สำเนา / COPY' : ''}";
        font-family: 'TH Sarabun PSK', sans-serif;
        font-size: 12pt;
        color: #596761;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #202d29;
      background: #fff;
      font-family: 'TH Sarabun PSK', sans-serif;
      font-size: 16pt;
      line-height: 1.1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1, h2, p { margin: 0; }
    .muted, .label { color: #596761; }
    .label { font-size: 14pt; }
    .number { font-variant-numeric: tabular-nums; }
    .header { border-bottom: 1.5pt solid #168360; padding-bottom: 4mm; }
    .brand { display: flex; align-items: flex-start; gap: 4mm; }
    .logo { width: 21mm; flex: 0 0 21mm; }
    .logo svg { display: block; width: 100%; height: auto; }
    .document-title { text-align: right; margin-bottom: 5mm; }
    h1 { font-size: 32pt; line-height: 1.1; font-weight: 700; }
    .subtitle { margin-top: 2mm; font-family: Arial, sans-serif; font-size: 8pt; letter-spacing: 1.8px; color: #596761; }
    .header-details { display: grid; grid-template-columns: minmax(0, 1fr) 65mm; gap: 7mm; }
    .company { min-width: 0; overflow-wrap: anywhere; font-size: 14pt; }
    .company-name { font-size: 17pt; margin-bottom: 1mm; }
    .company-contact { margin-top: 1mm; }
    .document-details { font-size: 15pt; }
    .meta-row { display: grid; grid-template-columns: 16mm minmax(0, 1fr); gap: 2mm; margin-bottom: 1mm; }
    .meta-row > :last-child { text-align: right; overflow-wrap: anywhere; }
    .copy-status { display: block; text-align: right; color: #168360; font-size: 14pt; font-weight: 700; margin-top: 2mm; }
    .section { margin-top: 4mm; }
    h2 { font-size: 17pt; font-weight: 700; margin-bottom: 2.5mm; }
    .seller { padding-bottom: 3mm; border-bottom: 0.5pt solid #d8dfdb; }
    .seller-row { display: grid; grid-template-columns: 29mm minmax(0, 1fr); column-gap: 3mm; margin-top: 1mm; }
    .seller-contact { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 4mm; }
    .seller-row > :last-child { overflow-wrap: anywhere; }
    .seller-name { font-size: 18pt; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { background: #f2f5f3; padding: 2.5mm 3mm; font-weight: 700; font-size: 14pt; text-align: left; border-top: 0.5pt solid #d8dfdb; border-bottom: 0.5pt solid #d8dfdb; }
    td { padding: 3mm 3mm 4mm; vertical-align: top; border-bottom: 0.5pt solid #d8dfdb; overflow-wrap: anywhere; }
    th:first-child, td:first-child { padding-left: 1mm; }
    th:last-child, td:last-child { padding-right: 1mm; }
    .center { text-align: center; }
    .right { text-align: right; }
    .device-name { font-size: 18pt; font-weight: 700; }
    .device-details { margin-top: 1.5mm; font-size: 14pt; color: #596761; }
    .total { margin-top: 3mm; padding: 3mm; background: #eef6f2; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5mm; align-items: center; }
    .amount-words { overflow-wrap: anywhere; }
    .total-amount { text-align: right; }
    .amount { font-size: 30pt; font-weight: 700; color: #116747; line-height: 1.1; white-space: nowrap; }
    .currency { font-size: 15pt; font-weight: 400; }
    .payment { margin-top: 4mm; }
    .payment-row { display: grid; grid-template-columns: 29mm minmax(0, 1fr); gap: 3mm; margin-top: 1mm; }
    .payment-row > :last-child { overflow-wrap: anywhere; }
    .credit-note { margin-top: 2mm; color: #596761; font-size: 14pt; }
    .declaration { margin-top: 4mm; border-top: 0.5pt solid #d8dfdb; padding-top: 3mm; font-size: 14pt; color: #596761; }
    .signatures { margin-top: 4mm; display: flex; gap: 15mm; }
    .signer { flex: 1; min-width: 0; text-align: center; overflow-wrap: anywhere; }
    .signature-space { height: 18mm; display: flex; align-items: center; justify-content: center; border-bottom: 0.5pt solid #a8b6ae; margin-bottom: 2mm; }
    .signature-space img { max-width: 100%; max-height: 16mm; object-fit: contain; }
    .signature-space .muted { font-size: 14pt; }
    .signer-role { font-size: 14pt; margin-top: 1mm; }
    .signer-date { font-size: 13pt; color: #596761; margin-top: 1mm; }
    footer { margin-top: 5mm; padding-top: 2mm; border-top: 0.5pt solid #d8dfdb; display: flex; justify-content: space-between; gap: 5mm; color: #596761; font-size: 12pt; }
    footer span { overflow-wrap: anywhere; }
    .header, .seller, tr, .total, .payment, .declaration, .signatures, footer { break-inside: avoid; }
    h2 { break-after: avoid; }
    p { orphans: 3; widows: 3; }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-details">
      <div class="brand">
        <div class="logo">${this.logoSvg()}</div>
        <div class="company">
          <p class="company-name"><strong>${esc(company.nameTh)}</strong></p>
          <p>${esc(company.address)}</p>
          <p class="company-contact">เลขประจำตัวผู้เสียภาษี ${esc(company.taxId)}</p>
          ${company.phone ? `<p>โทร. ${esc(company.phone)}</p>` : ''}
        </div>
      </div>
      <div class="document-details">
        <div class="document-title">
          <h1>${title}</h1>
          <p class="subtitle">${isCredit ? 'TRADE-IN RECEIPT' : 'PAYMENT VOUCHER'}</p>
        </div>
        <div class="meta-row"><span class="label">เลขที่</span><strong class="number">${esc(data.voucherNumber)}</strong></div>
        <div class="meta-row"><span class="label">วันที่</span><span>${date}</span></div>
        <span class="copy-status">${data.isReprint ? 'สำเนา / COPY' : 'ต้นฉบับ / ORIGINAL'}</span>
      </div>
    </div>
  </header>

  <section class="seller section">
    <h2>${isCredit ? 'ผู้ส่งมอบเครื่อง' : 'ผู้รับเงิน / ผู้ขาย'}</h2>
    <div class="seller-row"><span class="label">ชื่อ–นามสกุล</span><strong class="seller-name">${esc(data.sellerName)}</strong></div>
    <div class="seller-contact">
      <div class="seller-row"><span class="label">เลขบัตรประชาชน</span><span class="number">${esc(data.sellerIdCard)}</span></div>
      <div class="seller-row"><span class="label">โทรศัพท์</span><span class="number">${esc(data.sellerPhone)}</span></div>
    </div>
    <div class="seller-row"><span class="label">ที่อยู่</span><span>${esc(data.sellerAddress)}</span></div>
  </section>

  <section class="section">
    <h2>${isCredit ? 'รายการรับเครื่องเทิร์น' : 'รายการรับซื้อ'}</h2>
    <table aria-label="${isCredit ? 'รายการเครื่องเทิร์น' : 'รายการจ่ายเงิน'}">
      <colgroup><col style="width:12mm"><col><col style="width:19mm"><col style="width:37mm"></colgroup>
      <thead><tr><th class="center">ลำดับ</th><th>รายละเอียดเครื่อง</th><th class="center">จำนวน</th><th class="right">${isCredit ? 'มูลค่า (บาท)' : 'จำนวนเงิน (บาท)'}</th></tr></thead>
      <tbody><tr>
        <td class="center">1</td>
        <td><p class="device-name">${esc(deviceName)}</p>${deviceDetails.length ? `<p class="device-details">${esc(deviceDetails.join('\n'))}</p>` : ''}</td>
        <td class="center">1 เครื่อง</td>
        <td class="right number"><strong>${this.formatBaht(data.amount)}</strong></td>
      </tr></tbody>
    </table>
    <div class="total">
      <div class="amount-words"><p class="label">จำนวนเงินเป็นตัวอักษร</p><p>${esc(data.amountText)}</p></div>
      <div class="total-amount"><p class="label">${isCredit ? 'ยอดเครดิตที่ตกลง' : 'ยอดจ่ายสุทธิ'}</p><p class="amount number">${this.formatBaht(data.amount)} <span class="currency">บาท</span></p></div>
    </div>
  </section>

  <section class="payment">
    <div class="payment-row"><strong>${isCredit ? 'รูปแบบการรับเครื่อง' : 'วิธีจ่ายเงิน'}</strong><strong>${isCredit ? 'เครดิตเทิร์นเครื่อง' : data.paymentMethod === 'TRANSFER' ? 'โอนเงินเข้าบัญชีผู้ขาย' : 'เงินสด'}</strong></div>
    ${
      isCredit
        ? '<p class="credit-note">เอกสารนี้ยืนยันการรับเครื่อง ยังไม่ยืนยันการนำเครดิตไปใช้</p>'
        : data.paymentMethod === 'TRANSFER'
          ? `<div class="payment-row"><span class="label">ธนาคาร / เลขบัญชี</span><span>${esc(data.transferBankName || '-')} / <span class="number">${esc(data.transferAccountNumber || '-')}</span></span></div>
           <div class="payment-row"><span class="label">ชื่อบัญชีผู้รับเงิน</span><span>${esc(data.transferAccountName || '-')}</span></div>`
          : `<div class="payment-row"><span class="label">ผู้รับเงินสด</span><span>${esc(data.sellerName)}</span></div>`
    }
  </section>

  <p class="declaration"><strong>คำรับรองผู้ขาย</strong> ผู้ขายรับรองว่าเป็นเจ้าของเครื่องโดยชอบด้วยกฎหมาย และยินยอมให้บริษัทตรวจสอบที่มาของเครื่อง หากพบว่าเป็นทรัพย์สินที่ได้มาโดยมิชอบ ผู้ขายยินยอมให้ดำเนินคดีตามกฎหมาย</p>

  <section class="signatures" aria-label="ลายเซ็น">
    <div class="signer">
      <div class="signature-space">${signature(data.issuerSignatureBase64, 'ลายเซ็นผู้ออกเอกสาร')}</div>
      <strong>${esc(data.issuerName)}</strong>
      <p class="signer-role">ผู้รับซื้อ / ผู้ออกเอกสาร</p>
      <p class="signer-date">วันที่ ${date}</p>
    </div>
    <div class="signer">
      <div class="signature-space">${signature(data.sellerSignatureBase64, 'ลายเซ็นผู้ขาย')}</div>
      <strong>${esc(data.sellerName)}</strong>
      <p class="signer-role">${isCredit ? 'ผู้ส่งมอบเครื่อง' : 'ผู้รับเงิน (ผู้ขาย)'}</p>
      <p class="signer-date">วันที่ ${date}</p>
    </div>
  </section>

  <footer><span class="number">${esc(data.voucherNumber)}</span><span>ออกโดยระบบ BESTCHOICE</span></footer>
</body>
</html>`;
  }
}
