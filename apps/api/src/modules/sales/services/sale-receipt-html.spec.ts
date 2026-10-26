import { Prisma } from '@prisma/client';
import { DEFAULT_RECEIPT_WARRANTY_TERMS } from '@installment/shared';
import { thaiBahtText } from '../../../utils/thai-baht-text.util';
import { buildSaleReceiptHtml, toSaleReceiptModel, type SaleForReceipt } from './sale-receipt-html';

/**
 * ใบเสร็จขายสด (ก้อน 4) — ตัวแปลง Sale → model และตัวสร้าง HTML เป็นฟังก์ชันบริสุทธิ์
 * ตรวจด้วยสตริงตาม mockup `Receipt.dc.html` ที่เจ้าของเคาะ 2026-10-22.
 */
const D = (v: number | string) => new Prisma.Decimal(v);

const company = {
  nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
  address: '456/21 ถนนนารายณ์มหาราช ลพบุรี 15000',
  taxId: '0165568000050',
  phone: '036-411-999',
};

function cashSale(overrides: Partial<SaleForReceipt> = {}): SaleForReceipt {
  return {
    id: 's1',
    saleNumber: 'SL-20261022-0001',
    saleType: 'CASH',
    createdAt: new Date('2026-10-22T07:32:00Z'),
    // ตามโค้ดขายจริง: netAmount = sellingPrice − discount (ยังไม่หัก base เทิร์น) · cashDue = net − base = 22,900
    sellingPrice: D('31900'),
    discount: D('1000'),
    netAmount: D('30900'),
    paymentMethod: 'CASH',
    amountReceived: D('22900'),
    financeCompany: null,
    financeRefNumber: null,
    financeAmount: null,
    downPaymentAmount: null,
    bundleProductIds: ['b1', 'b2'],
    shopWarrantyStartDate: new Date('2026-10-22T00:00:00Z'),
    shopWarrantyEndDate: new Date('2026-10-29T00:00:00Z'),
    productDisclosure: { version: 1, deviceOrigin: 'THAI', shopWarrantyDays: 7, warrantyTerms: null },
    tradeInCreditSnapshot: {
      version: 1, redemptionId: 'r1', tradeInId: 'ti1', voucherNumber: 'TI-20261022-0003',
      baseAmount: '8000.00', bonusAmount: '0.00', cashDownAmount: '22900.00', totalDownAmount: '30900.00',
    },
    deletedAt: null,
    voidReason: null,
    customer: { name: 'คุณสมหญิง ใจดี', phone: '089-999-9999', legacyMemberCode: 'C-00412' },
    product: {
      name: 'Apple iPhone 15 Pro Max 256GB ดำ', brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB',
      imeiSerial: '357200606382344', serialNumber: null, category: 'PHONE_USED',
    },
    branch: { name: 'ลพบุรี' },
    salesperson: { name: 'สมชาย ใจดี' },
    shopTenders: [
      { method: 'CASH', amount: D('5000'), reference: null, seq: 1 },
      { method: 'BANK_TRANSFER', amount: D('17900'), reference: '2510221432', seq: 2 },
    ],
    bundleProducts: [
      { name: 'เคสใส iPhone 15 Pro Max', imeiSerial: null, legacyProductCode: 'ACC-001' },
      { name: 'ฟิล์มกระจก', imeiSerial: null, legacyProductCode: null },
    ],
    receiptBreakdown: null,
    ...overrides,
  };
}

function financeSale(): SaleForReceipt {
  return cashSale({
    saleNumber: 'SL-20261022-0002',
    saleType: 'EXTERNAL_FINANCE',
    sellingPrice: D('41900'),
    discount: D('0'),
    netAmount: D('41900'),
    paymentMethod: 'BANK_TRANSFER',
    amountReceived: D('5000'),
    financeCompany: 'GFIN',
    financeRefNumber: 'GF-7781',
    financeAmount: D('36900'),
    downPaymentAmount: D('5000'),
    bundleProductIds: [],
    bundleProducts: [],
    tradeInCreditSnapshot: null,
    shopWarrantyStartDate: null,
    shopWarrantyEndDate: null,
    productDisclosure: { version: 1, deviceOrigin: 'THAI', shopWarrantyDays: 0, warrantyTerms: null },
    product: {
      name: 'Samsung Galaxy S24 Ultra 512GB', brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '512GB',
      imeiSerial: '352099001761481', serialNumber: null, category: 'PHONE_NEW',
    },
    customer: { name: 'นายสมชาย รักดี', phone: '082-222-2222', legacyMemberCode: null },
    shopTenders: [{ method: 'BANK_TRANSFER', amount: D('5000'), reference: '2510221510', seq: 1 }],
  });
}

const ctx = { company, terms: DEFAULT_RECEIPT_WARRANTY_TERMS, qrDataUrl: 'data:image/png;base64,QR' };

describe('toSaleReceiptModel', () => {
  it('maps cash tenders with method labels and keeps the reference only where it exists', () => {
    const m = toSaleReceiptModel(cashSale(), ctx);
    expect(m.tenders).toEqual([
      { label: 'เงินสด', amount: '5000.00', reference: null },
      { label: 'โอน', amount: '17900.00', reference: '2510221432' },
    ]);
    expect(m.totals.received).toBe('22900.00');
  });

  it('falls back to paymentMethod + amountReceived when the sale has no tenders (legacy rows)', () => {
    const m = toSaleReceiptModel(cashSale({ shopTenders: [], paymentMethod: 'QR_EWALLET', amountReceived: D('22900') }), ctx);
    expect(m.tenders).toEqual([{ label: 'QR/e-Wallet', amount: '22900.00', reference: null }]);
    expect(m.totals.received).toBe('22900.00');
  });

  it('exposes the trade-in credit line with the voucher number; net is before the credit, received after', () => {
    const m = toSaleReceiptModel(cashSale(), ctx);
    expect(m.totals.tradeIn).toEqual({ voucher: 'TI-20261022-0003', amount: '8000.00' });
    expect(m.totals.gross).toBe('31900.00');
    expect(m.totals.discount).toBe('1000.00');
    expect(m.totals.net).toBe('30900.00');
    expect(m.totals.received).toBe('22900.00');
  });

  it('adds the booking deposit to the amount received and never prints a fallback tender beside it', () => {
    const noTradeIn = { tradeInCreditSnapshot: null, sellingPrice: D('23900'), discount: D('1000'), netAmount: D('22900') };
    const balancePaid = toSaleReceiptModel(
      cashSale({
        ...noTradeIn,
        receiptBreakdown: { depositAmount: '5000.00', depositMethod: 'BANK_TRANSFER', additionalAmount: '17900.00' },
        shopTenders: [{ method: 'BANK_TRANSFER', amount: D('17900'), reference: '2510221432', seq: 1 }],
      }),
      ctx,
    );
    expect(balancePaid.depositLine).toEqual({ label: 'มัดจำจอง (โอน)', amount: '5000.00' });
    expect(balancePaid.tenders).toEqual([{ label: 'โอน', amount: '17900.00', reference: '2510221432' }]);
    expect(balancePaid.totals.received).toBe('22900.00');

    const prepaid = toSaleReceiptModel(
      cashSale({
        ...noTradeIn,
        amountReceived: D('22900'),
        receiptBreakdown: { depositAmount: '22900.00', depositMethod: 'CASH', additionalAmount: '0.00' },
        shopTenders: [],
      }),
      ctx,
    );
    expect(prepaid.depositLine).toEqual({ label: 'มัดจำจอง (เงินสด)', amount: '22900.00' });
    expect(prepaid.tenders).toEqual([]);
    expect(prepaid.totals.received).toBe('22900.00');
  });

  it('maps an external-finance sale to a down-payment receipt', () => {
    const m = toSaleReceiptModel(financeSale(), ctx);
    expect(m.saleType).toBe('EXTERNAL_FINANCE');
    expect(m.finance).toEqual({ company: 'GFIN', refNumber: 'GF-7781', amount: '36900.00' });
    expect(m.totals.downPayment).toBe('5000.00');
    expect(m.totals.received).toBe('5000.00');
  });

  it('labels the device identifier as IMEI, then S/N, then nothing', () => {
    expect(toSaleReceiptModel(cashSale(), ctx).mainItem).toMatchObject({ idLabel: 'IMEI', idValue: '357200606382344' });
    const sn = cashSale({ product: { ...cashSale().product, imeiSerial: null, serialNumber: 'SN-1' } });
    expect(toSaleReceiptModel(sn, ctx).mainItem).toMatchObject({ idLabel: 'S/N', idValue: 'SN-1' });
    const none = cashSale({ product: { ...cashSale().product, imeiSerial: null, serialNumber: null } });
    expect(toSaleReceiptModel(none, ctx).mainItem.idLabel).toBeNull();
  });

  it('starts the item note with the condition and appends the disclosure text', () => {
    const m = toSaleReceiptModel(cashSale(), ctx);
    expect(m.mainItem.note.startsWith('มือสอง')).toBe(true);
    expect(m.mainItem.note).toContain('เครื่องไทย');
    expect(toSaleReceiptModel(financeSale(), ctx).mainItem.note.startsWith('เครื่องใหม่')).toBe(true);
  });

  it('builds the warranty headline from the real dates, and a no-warranty line otherwise', () => {
    const m = toSaleReceiptModel(cashSale(), ctx);
    expect(m.warranty.headline).toBe('ประกันร้าน 7 วัน · 22/10/2569 – 29/10/2569');
    expect(m.warranty.terms).toBe(DEFAULT_RECEIPT_WARRANTY_TERMS);
    expect(toSaleReceiptModel(financeSale(), ctx).warranty.headline).toBe('ไม่มีประกันร้าน · ประกันศูนย์ตามเงื่อนไขผู้ผลิต');
  });

  it('adds a booking-deposit line when the sale came from a booking', () => {
    const m = toSaleReceiptModel(
      cashSale({ receiptBreakdown: { depositAmount: '2000.00', depositMethod: 'BANK_TRANSFER', additionalAmount: '20900.00' } }),
      ctx,
    );
    expect(m.depositLine?.label.startsWith('มัดจำจอง')).toBe(true);
    expect(m.depositLine?.amount).toBe('2000.00');
  });

  it('carries void info when the sale was cancelled', () => {
    const m = toSaleReceiptModel(cashSale({ deletedAt: new Date('2026-10-23T01:00:00Z'), voidReason: 'คีย์ผิดเครื่อง' }), ctx);
    expect(m.voided).toEqual({ at: new Date('2026-10-23T01:00:00Z'), reason: 'คีย์ผิดเครื่อง' });
  });
});

describe('buildSaleReceiptHtml', () => {
  const fontCss = '/* fonts */';

  it('renders the cash receipt header, totals, bundle rows, QR, seller and VAT notice', () => {
    const html = buildSaleReceiptHtml(toSaleReceiptModel(cashSale(), ctx), fontCss);
    expect(html).toContain('ใบเสร็จรับเงิน');
    expect(html).toContain('RECEIPT · ต้นฉบับ');
    expect(html).not.toContain('· เงินดาวน์');
    expect(html).toContain('SL-20261022-0001');
    expect(html).toContain('ลพบุรี');
    expect(html).toContain('อ้างอิง 2510221432');
    expect((html.match(/ของแถม/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('TI-20261022-0003');
    expect(html).toContain('22,900.00');
    expect(html).toContain('30,900.00');
    expect(html).toContain(thaiBahtText(22900));
    // ลำดับสรุปเงินต้องบวกลบลงตัว: ยอดสุทธิ (net) → หักเครดิตเทิร์น → จำนวนเงินที่รับ
    const netAt = html.indexOf('ยอดสุทธิ');
    const tradeInAt = html.indexOf('หักเครดิตเทิร์น');
    const receivedAt = html.indexOf('จำนวนเงินที่รับ');
    expect(netAt).toBeGreaterThan(0);
    expect(tradeInAt).toBeGreaterThan(netAt);
    expect(receivedAt).toBeGreaterThan(tradeInAt);
    expect(html).toContain('ประกันร้าน 7 วัน');
    expect(html).toContain(DEFAULT_RECEIPT_WARRANTY_TERMS);
    expect(html).toContain('ไม่ใช่ใบกำกับภาษี');
    expect(html).toContain('<img src="data:image/png;base64,QR"');
    expect(html).toContain('สมชาย ใจดี');
    expect(html).toContain(fontCss);
    expect(html).not.toContain('ยกเลิกเมื่อ');
  });

  it('renders the external-finance variant with the down-payment title and remainder sentence', () => {
    const html = buildSaleReceiptHtml(toSaleReceiptModel(financeSale(), ctx), fontCss);
    expect(html).toContain('RECEIPT · ต้นฉบับ · เงินดาวน์');
    expect(html).toContain('ส่วนที่เหลือ 36,900.00 บาท ชำระกับ GFIN');
    expect(html).toContain('GF-7781');
    expect(html).toContain('เงินดาวน์ที่รับ');
    expect(html).toContain(thaiBahtText(5000));
    expect(html).not.toContain('ของแถม');
  });

  it('escapes customer and product text', () => {
    const sale = cashSale({ customer: { name: 'A&B <x>', phone: '0', legacyMemberCode: null } });
    const html = buildSaleReceiptHtml(toSaleReceiptModel(sale, ctx), fontCss);
    expect(html).toContain('A&amp;B &lt;x&gt;');
    expect(html).not.toContain('A&B <x>');
  });

  it('omits the QR block when there is no public link (voided sale that never had a token)', () => {
    const html = buildSaleReceiptHtml(toSaleReceiptModel(cashSale(), { ...ctx, qrDataUrl: '' }), fontCss);
    expect(html).not.toContain('<img src="data:image');
    expect(html).not.toContain('สแกนเพื่อเปิดใบเสร็จ');
    expect(html).toContain('ติดต่อ');
  });

  it('stamps the void watermark and cancellation line on a voided sale', () => {
    const sale = cashSale({ deletedAt: new Date('2026-10-23T01:00:00Z'), voidReason: 'คีย์ผิดเครื่อง' });
    const html = buildSaleReceiptHtml(toSaleReceiptModel(sale, ctx), fontCss);
    expect(html).toContain('ยกเลิกเมื่อ');
    expect(html).toContain('คีย์ผิดเครื่อง');
    expect(html).toContain('class="void"');
  });
});
