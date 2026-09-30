import { Prisma } from '@prisma/client';
import { legacyReceiptDocumentMoney, ReceiptMoneyView } from './receipt-document-money';

/**
 * ตัวเลขบนเอกสารใบเสร็จ — ตรรกะเดิม (ใบที่ไม่มีค่าที่เก็บ ณ ตอนออกใบ) ย้ายออกจาก receipt-pdf.service.ts ทุกตัวอักษร
 * ตัวเลขชุดเดียวกับ receipt-pdf.service.spec.ts (ต้องไม่เปลี่ยน) — PR3 ใช้ตัวนี้คัดลอกค่าของใบเก่าลงใบลดหนี้ด้วย
 */
const D = (v: string) => new Prisma.Decimal(v);

/** สัญญา 22,000 / 10 งวด: ค่างวด 4,179.44 + VAT 292.56 = 4,472.00 */
const CONTRACT_10M = {
  totalMonths: 10,
  financedAmount: D('22000'),
  storeCommission: D('2200'),
  interestTotal: D('17594.40'),
  vatAmount: D('2925.61'),
};

/** สัญญามาตรฐาน 17,000 / 12 งวด: ค่างวด 1,416.66 + VAT 99.17 = 1,515.83 */
const CONTRACT_17K = {
  totalMonths: 12,
  financedAmount: D('10000'),
  storeCommission: D('1000'),
  interestTotal: D('6000'),
  vatAmount: D('1190'),
};

const view = (o: Partial<ReceiptMoneyView> = {}): ReceiptMoneyView => ({
  receiptType: 'INSTALLMENT',
  amount: D('5516'),
  amountBeforeVat: null,
  vatAmount: null,
  installmentNo: 4,
  lateFeeCollected: '0.00',
  lateFeeWaivedThisReceipt: '0.00',
  hasReceiptFeeHistory: true,
  priorReceiptCount: 0,
  payment: null,
  installmentAllocations: [
    { installmentNo: 4, amount: '4472.00', kind: 'INSTALLMENT' },
    { installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' },
  ],
  contract: CONTRACT_10M,
  ...o,
});

const f = (d: Prisma.Decimal) => d.toFixed(2);

describe('legacyReceiptDocumentMoney — ตรรกะเดิมของ PDF (ย้ายมาโดยไม่เปลี่ยนตัวเลข)', () => {
  it('ใบรวม 5,516 = ค่างวด 4,472 + เงินพักค่าปรับดิว 1,044 → 5,155.14 / 360.86 · แถวค่างวด 4,179.44 / 292.56 · แถวพัก 975.70 / 68.30', () => {
    const m = legacyReceiptDocumentMoney(view());

    expect([f(m.exclVat), f(m.vatPart)]).toEqual(['5155.14', '360.86']);
    expect([f(m.installmentPortion), f(m.installmentExclVat), f(m.installmentVat)]).toEqual([
      '4472.00',
      '4179.44',
      '292.56',
    ]);
    expect(
      m.advanceRows.map((r) => [r.kind, r.installmentNo, f(r.amount), f(r.beforeVat), f(r.vat)]),
    ).toEqual([['RESCHEDULE', 10, '1044.00', '975.70', '68.30']]);
    expect(f(m.rounding)).toBe('0.00');
  });

  it('ใบ 3,050 = ค่างวด 3,000 + ค่าปรับ 50 → แถวค่าปรับ 50 · VAT ของค่างวดคิด ×100/107 (196.26)', () => {
    const m = legacyReceiptDocumentMoney(
      view({
        amount: D('3050'),
        installmentNo: 2,
        lateFeeCollected: '50.00',
        installmentAllocations: [{ installmentNo: 2, amount: '3000.00', kind: 'INSTALLMENT' }],
      }),
    );

    expect([f(m.feeCharged), f(m.feeWaived), f(m.feePortion)]).toEqual(['50.00', '0.00', '50.00']);
    expect([f(m.exclVat), f(m.vatPart)]).toEqual(['2803.74', '196.26']);
    expect(m.advanceRows).toEqual([]);
  });

  it('เงินรับล่วงหน้าทั่วไป (ไม่รู้งวดเป้าหมาย) → แถว "เงินรับล่วงหน้าในสัญญา" หนึ่งแถว', () => {
    const m = legacyReceiptDocumentMoney(
      view({ installmentAllocations: null, receiptAdvanceAmount: '1044.00' }),
    );

    expect(m.advanceRows.map((r) => [r.kind, f(r.amount), f(r.vat)])).toEqual([
      ['GENERIC', '1044.00', '68.30'],
    ]);
  });

  it('ใบเสร็จปิดยอดก่อนกำหนด (ไม่เก็บค่า — ย้ายไป PR5) → ตัวเลขเดิม: 17,339.96 ถอด ×100/107 = 16,205.57 / 1,134.39 ไม่มีแถวค่าปรับ', () => {
    const m = legacyReceiptDocumentMoney(
      view({
        receiptType: 'EARLY_PAYOFF',
        amount: D('17339.96'),
        installmentNo: null,
        lateFeeCollected: null,
        lateFeeWaivedThisReceipt: null,
        hasReceiptFeeHistory: false,
        installmentAllocations: null,
        contract: CONTRACT_17K,
      }),
    );

    expect([f(m.exclVat), f(m.vatPart)]).toEqual(['16205.57', '1134.39']);
    expect(f(m.installmentPortion)).toBe('17339.96');
    expect(f(m.feeCharged)).toBe('0.00');
    expect(m.advanceRows).toEqual([]);
  });

  it('ประวัติไม่พอแยกค่างวด/เงินรับล่วงหน้า → ปฏิเสธเหมือนเดิม', () => {
    expect(() => legacyReceiptDocumentMoney(view({ installmentAllocations: null }))).toThrow(
      'ไม่สามารถแยกค่างวดและเงินรับล่วงหน้าของใบเสร็จนี้จากประวัติได้',
    );
  });
});
