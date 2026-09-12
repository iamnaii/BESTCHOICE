import { VoucherHtmlBuilder } from './voucher-html.builder';
import { LEGACY_TRADE_IN_DECLARATION, TRADE_IN_DECLARATION_TEXT } from '@installment/shared';

describe('VoucherHtmlBuilder', () => {
  const builder = new VoucherHtmlBuilder();
  const voucher: Parameters<VoucherHtmlBuilder['buildHtml']>[0] = {
    voucherNumber: 'EXP-20260900001',
    voucherDate: new Date(2026, 8, 8),
    isReprint: false,
    company: null,
    sellerName: 'ผู้ขายตัวอย่าง',
    sellerAddress: 'ที่อยู่ตัวอย่าง',
    sellerPhone: '0000000000',
    sellerIdCard: '0000000000000',
    sellerSignatureBase64: null,
    issuerName: 'ผู้ออกเอกสารตัวอย่าง',
    issuerSignatureBase64: null,
    deviceLabel: 'Apple iPhone 15\nสีดำ IMEI 000000000000001',
    amount: 18500.25,
    amountText: builder.numberToThaiBahtText(18500.25),
    paymentMethod: 'CASH',
    transferBankName: null,
    transferAccountNumber: null,
    transferAccountName: null,
  };

  it('preserves voucher details and marks the first print and subsequent copies explicitly', () => {
    const html = builder.buildHtml(voucher);
    for (const text of [
      voucher.voucherNumber,
      '8 กันยายน 2569',
      voucher.sellerName,
      voucher.issuerName,
      voucher.sellerIdCard,
      'IMEI 000000000000001',
      '18,500.25',
      voucher.amountText,
      'ต้นฉบับ / ORIGINAL',
    ])
      expect(html).toContain(text);
    expect(builder.buildHtml({ ...voucher, isReprint: true })).toContain('สำเนา / COPY');
    expect(html).not.toContain('สแกนเพื่อตรวจสอบ');
    expect(html).not.toContain('/verify/voucher/');
  });

  it('labels both device identifiers independently, including missing historical values', () => {
    const device = { deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: null, deviceColor: null, imei: '359000000000081' };
    const label = builder.buildDeviceLabel({ ...device, serialNumber: 'BC-SN-00081' });
    const html = builder.buildHtml({ ...voucher, deviceLabel: label });
    expect(html).toContain('IMEI: 359000000000081<br>Serial Number: BC-SN-00081');
    const missing = builder.buildDeviceLabel({ ...device, imei: null });
    expect(missing).toContain('IMEI: ไม่ระบุ\nSerial Number: ไม่ระบุ');
    const serialOnly = builder.buildDeviceLabel({ ...device, imei: null, serialNumber: '<SN&81>' });
    expect(builder.buildHtml({ ...voucher, deviceLabel: serialOnly })).toContain('Serial Number: &lt;SN&amp;81&gt;');
  });

  it('renders saved signatures or leaves a signing space for each party', () => {
    const unsigned = builder.buildHtml(voucher);
    expect(unsigned.match(/ลงชื่อ \.{48}/g)).toHaveLength(2);
    const sellerSignature = 'data:image/png;base64,c2VsbGVy';
    const issuerSignature = 'data:image/png;base64,aXNzdWVy';
    const signed = builder.buildHtml({
      ...voucher,
      sellerSignatureBase64: sellerSignature,
      issuerSignatureBase64: issuerSignature,
    });
    expect(signed).toContain(`src="${sellerSignature}" alt="ลายเซ็นผู้ขาย"`);
    expect(signed).toContain(`src="${issuerSignature}" alt="ลายเซ็นผู้ออกเอกสาร"`);
    expect(signed).not.toContain('ลงชื่อ ................................................');
  });

  it('preserves legacy wording and renders only the supplied signed text for new receipts', () => {
    expect(builder.buildHtml(voucher)).toContain(LEGACY_TRADE_IN_DECLARATION);
    expect(builder.buildHtml(voucher)).not.toContain('ภาระจำนำ');
    const html = builder.buildHtml({ ...voucher, sellerDeclarationText: TRADE_IN_DECLARATION_TEXT });
    expect(html).toContain('ภาระจำนำ');
    expect(html).toContain('ไม่เรียกซ้ำส่วนที่คืนหรือชดใช้แล้ว');
    expect(html).not.toContain(LEGACY_TRADE_IN_DECLARATION);
    const historical = builder.buildHtml({ ...voucher, sellerDeclarationText: 'ข้อที่เคยลงนาม <เดิม>\nบรรทัดถัดไป' });
    expect(historical).toContain('ข้อที่เคยลงนาม &lt;เดิม&gt;<br>บรรทัดถัดไป');
    expect(historical).not.toContain('ภาระจำนำ');
  });

  it('lets the closing block paginate while keeping amount + payment and declaration + signatures each together (DOC-02)', () => {
    const html = builder.buildHtml({ ...voucher, paymentMethod: 'TRADE_IN_CREDIT', creditBaseAmount: 6000, creditBonusAmount: 0, sellerDeclarationText: TRADE_IN_DECLARATION_TEXT });
    // Shared transaction CSS keeps .bc-doc-closing unbreakable; the voucher's declaration makes that block
    // taller than half a page, which used to push every amount line onto a near-empty second page.
    expect(html).toContain('body .bc-doc-closing { break-inside: auto; }');
    expect(html).toContain('.bc-doc-settlement, .bc-doc-attestation { break-inside: avoid; }');
    const settlement = html.indexOf('<div class="bc-doc-settlement">');
    const attestation = html.indexOf('<div class="bc-doc-attestation">');
    expect(settlement).toBeGreaterThan(-1);
    expect(attestation).toBeGreaterThan(settlement);
    // amount + payment live in the settlement group; declaration, both signatures and the footer in the attestation group
    expect(html.slice(settlement, attestation)).toContain('ยอดเครดิตที่ตกลง');
    expect(html.slice(settlement, attestation)).toContain('รูปแบบการรับเครื่อง');
    expect(html.slice(settlement, attestation)).not.toContain('คำรับรองผู้ขาย');
    const tail = html.slice(attestation);
    for (const text of ['คำรับรองผู้ขาย', 'ผู้รับซื้อ / ผู้ออกเอกสาร', 'ผู้ส่งมอบเครื่อง', 'ออกโดยระบบ BESTCHOICE']) expect(tail).toContain(text);
    expect(tail.indexOf('bc-doc-footer')).toBeGreaterThan(tail.indexOf('bc-doc-approval'));
  });

  it('escapes supplied company, seller, device and recipient details as text', () => {
    const input = '<script>alert("x")</script> & ตัวอย่าง';
    const html = builder.buildHtml({
      ...voucher,
      company: { nameTh: input, address: input, taxId: input, phone: input },
      sellerName: input,
      sellerAddress: `${input}\nชั้น 2`,
      sellerPhone: input,
      sellerIdCard: input,
      issuerName: input,
      deviceLabel: `${input}\nIMEI ${input}`,
      paymentMethod: 'TRANSFER',
      transferBankName: input,
      transferAccountNumber: input,
      transferAccountName: input,
    });
    expect(html).not.toContain(input);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; ตัวอย่าง');
    expect(html).toContain('ตัวอย่าง<br>ชั้น 2');
  });
});
