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
        font-family: 'IBM Plex Sans Thai', sans-serif;
        font-size: 8pt;
        color: #53635c;
      }
    }
    :root { --ink: #192d25; --muted: #53635c; --green: #16694f; --rule: #d4ddd8; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #fff;
      color: var(--ink);
      font-family: 'IBM Plex Sans Thai', sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1, h2, p { margin: 0; }
    strong { font-weight: 600; }
    .label, .muted { color: var(--muted); }
    .label { font-size: 9pt; }
    .number { font-variant-numeric: tabular-nums; }
    .masthead { display: grid; grid-template-columns: minmax(0, 1fr) 60mm; gap: 8mm; padding-bottom: 4mm; border-bottom: 1.2pt solid var(--green); }
    .brand { display: flex; align-items: flex-start; gap: 4mm; }
    .logo { flex: 0 0 20mm; width: 20mm; }
    .logo svg { width: 100%; height: auto; display: block; }
    .company { min-width: 0; font-size: 9pt; line-height: 1.6; overflow-wrap: anywhere; }
    .company-name { font-size: 11pt; font-weight: 600; margin-bottom: 1.5mm; }
    .company-contact { margin-top: 1mm; }
    .document-meta { font-size: 9pt; }
    .meta-row { display: grid; grid-template-columns: 14mm minmax(0, 1fr); gap: 2mm; margin-bottom: 1.5mm; }
    .meta-row > :last-child { text-align: right; overflow-wrap: anywhere; }
    .copy-status { margin-top: 2mm; text-align: right; font-size: 8pt; color: var(--muted); }
    .hero { margin-top: 4mm; }
    .document-title { min-width: 0; }
    h1 { font-size: 24pt; font-weight: 600; line-height: 1.3; letter-spacing: -0.5pt; }
    .subtitle { margin-top: 2mm; font-size: 8pt; letter-spacing: 1.5pt; color: var(--muted); }
    .total-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7mm; align-items: center; margin-top: 3mm; }
    .total-amount { text-align: right; }
    .amount { font-size: 30pt; font-weight: 600; line-height: 1.3; letter-spacing: -0.8pt; color: var(--green); white-space: nowrap; }
    .currency { margin-left: 2mm; font-size: 9pt; font-weight: 400; letter-spacing: normal; color: var(--muted); }
    .amount-words { font-size: 10pt; overflow-wrap: anywhere; }
    .amount-words .label { margin-bottom: 1mm; }
    .section { margin-top: 4mm; }
    h2 { font-size: 11pt; line-height: 1.5; font-weight: 600; margin-bottom: 2mm; }
    .section-title { display: flex; align-items: center; gap: 3mm; }
    .section-title::before { content: ''; width: 2mm; height: 2mm; background: var(--green); flex-shrink: 0; }
    .seller-row { display: grid; grid-template-columns: 28mm minmax(0, 1fr); gap: 3mm; margin-top: 1mm; align-items: baseline; }
    .seller-row > :last-child { overflow-wrap: anywhere; }
    .seller-name { font-size: 12pt; }
    .seller-contact { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 5mm; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { padding: 2mm 3mm; border-top: 0.5pt solid var(--rule); border-bottom: 0.5pt solid var(--rule); text-align: left; font-size: 9pt; font-weight: 500; color: var(--muted); }
    td { padding: 3mm; border-bottom: 0.5pt solid var(--rule); vertical-align: top; overflow-wrap: anywhere; }
    th:first-child, td:first-child { padding-left: 0; }
    th:last-child, td:last-child { padding-right: 0; }
    .center { text-align: center; }
    .right { text-align: right; }
    .device-name { font-size: 11pt; font-weight: 600; }
    .device-details { font-size: 9pt; color: var(--muted); line-height: 1.6; margin-top: 1.5mm; }
    .item-amount { white-space: nowrap; font-size: 11pt; }
    .payment { margin-top: 3mm; }
    .payment-row { display: grid; grid-template-columns: 37mm minmax(0, 1fr); gap: 3mm; margin-top: 1mm; align-items: baseline; }
    .payment-row > :last-child { overflow-wrap: anywhere; }
    .credit-note { margin-top: 2mm; font-size: 9pt; color: var(--muted); }
    .declaration { border-top: 0.5pt solid var(--rule); padding-top: 3mm; margin-top: 4mm; font-size: 9pt; line-height: 1.7; color: var(--muted); }
    .signatures { display: flex; gap: 16mm; margin-top: 4mm; }
    .signer { flex: 1; min-width: 0; text-align: center; font-size: 10pt; overflow-wrap: anywhere; }
    .signature-space { display: flex; align-items: center; justify-content: center; height: 19mm; border-bottom: 0.5pt solid #a8b8af; margin-bottom: 2.5mm; }
    .signature-space img { max-width: 100%; max-height: 16mm; object-fit: contain; }
    .signature-space .muted { font-size: 9pt; }
    .signer-role { font-size: 9pt; margin-top: 1.5mm; }
    .signer-date { font-size: 8pt; color: var(--muted); margin-top: 1mm; }
    footer { display: flex; justify-content: space-between; gap: 5mm; padding-top: 2.5mm; margin-top: 3mm; border-top: 0.5pt solid var(--rule); color: var(--muted); font-size: 8pt; }
    footer span { overflow-wrap: anywhere; }
    .masthead, .hero, .items, .seller, tr, .payment, .declaration, .signatures, footer { break-inside: avoid; }
    h2 { break-after: avoid; }
    p { orphans: 3; widows: 3; }
  </style>
</head>
<body>
  <header class="masthead">
    <div class="brand">
      <div class="logo">${this.logoSvg()}</div>
      <div class="company">
        <p class="company-name">${esc(company.nameTh)}</p>
        <p>${esc(company.address)}</p>
        <p class="company-contact">เลขประจำตัวผู้เสียภาษี ${esc(company.taxId)}</p>
        ${company.phone ? `<p>โทร. ${esc(company.phone)}</p>` : ''}
      </div>
    </div>
    <div class="document-meta">
      <div class="meta-row"><span class="label">เลขที่</span><strong class="number">${esc(data.voucherNumber)}</strong></div>
      <div class="meta-row"><span class="label">วันที่</span><span>${date}</span></div>
      <p class="copy-status">${data.isReprint ? 'สำเนา / COPY' : 'ต้นฉบับ / ORIGINAL'}</p>
    </div>
  </header>

  <section class="hero" aria-label="สรุปเอกสาร">
    <div class="document-title">
      <h1>${title}</h1>
      <p class="subtitle">${isCredit ? 'TRADE-IN RECEIPT' : 'PAYMENT VOUCHER'}</p>
    </div>
  </section>

  <section class="seller section">
    <h2 class="section-title">${isCredit ? 'ผู้ส่งมอบเครื่อง' : 'ผู้รับเงิน / ผู้ขาย'}</h2>
    <div class="seller-row"><span class="label">ชื่อ–นามสกุล</span><strong class="seller-name">${esc(data.sellerName)}</strong></div>
    <div class="seller-contact">
      <div class="seller-row"><span class="label">เลขบัตรประชาชน</span><span class="number">${esc(data.sellerIdCard)}</span></div>
      <div class="seller-row"><span class="label">โทรศัพท์</span><span class="number">${esc(data.sellerPhone)}</span></div>
    </div>
    <div class="seller-row"><span class="label">ที่อยู่</span><span>${esc(data.sellerAddress)}</span></div>
  </section>

  <section class="items section">
    <h2 class="section-title">${isCredit ? 'รายการรับเครื่องเทิร์น' : 'รายการรับซื้อ'}</h2>
    <table aria-label="${isCredit ? 'รายการเครื่องเทิร์น' : 'รายการจ่ายเงิน'}">
      <colgroup><col style="width:12mm"><col><col style="width:22mm"><col style="width:38mm"></colgroup>
      <thead><tr><th class="center">ลำดับ</th><th>รายละเอียดเครื่อง</th><th class="center">จำนวน</th><th class="right">${isCredit ? 'มูลค่า (บาท)' : 'จำนวนเงิน (บาท)'}</th></tr></thead>
      <tbody><tr>
        <td class="center">1</td>
        <td><p class="device-name">${esc(deviceName)}</p>${deviceDetails.length ? `<p class="device-details">${esc(deviceDetails.join('\n'))}</p>` : ''}</td>
        <td class="center">1 เครื่อง</td>
        <td class="right item-amount number"><strong>${this.formatBaht(data.amount)}</strong></td>
      </tr></tbody>
    </table>
    <div class="total-summary">
      <div class="amount-words"><p class="label">จำนวนเงินเป็นตัวอักษร</p><p>${esc(data.amountText)}</p></div>
      <div class="total-amount">
        <p class="label">${isCredit ? 'ยอดเครดิตที่ตกลง' : 'ยอดจ่ายสุทธิ'}</p>
        <p class="amount number">${this.formatBaht(data.amount)}<span class="currency">บาท</span></p>
      </div>
    </div>
  </section>

  <section class="payment">
    <h2 class="section-title">${isCredit ? 'การรับเครื่อง' : 'ข้อมูลการจ่ายเงิน'}</h2>
    <div class="payment-row"><span class="label">${isCredit ? 'รูปแบบการรับเครื่อง' : 'วิธีจ่ายเงิน'}</span><strong>${isCredit ? 'เครดิตเทิร์นเครื่อง' : data.paymentMethod === 'TRANSFER' ? 'โอนเงินเข้าบัญชีผู้ขาย' : 'เงินสด'}</strong></div>
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
