import { VoucherHtmlBuilder } from './voucher-html.builder';

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
