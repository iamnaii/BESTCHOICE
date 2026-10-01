import { Prisma } from '@prisma/client';
import {
  documentMoneyColumns,
  hasStoredReceiptTax,
  legacyReceiptDocumentMoney,
  receiptDocumentMoney,
  ReceiptMoneyView,
} from './receipt-document-money';

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

  it('งวดสุดท้าย (งวด 12 ของสัญญา 17,000) ยอด 1,515.87 เท่าค่างวดพอดี → ตัวเลขของบัญชี 1,416.74 / 99.13 (ไม่ใช่ ×100/107 = 1,416.70 / 99.17)', () => {
    // ปักแขน "ยอดเท่าค่างวดพอดี → ตัวเลขของบัญชี" ของตรรกะเดิม — ใบเก่าของงวดสุดท้ายต้องพิมพ์ซ้ำได้ตัวเลขเดิม (final review T7-2)
    const m = legacyReceiptDocumentMoney(
      view({
        amount: D('1515.87'),
        installmentNo: 12,
        installmentAllocations: [{ installmentNo: 12, amount: '1515.87', kind: 'INSTALLMENT' }],
        contract: CONTRACT_17K,
      }),
    );

    expect([f(m.exclVat), f(m.vatPart)]).toEqual(['1416.74', '99.13']);
    expect([f(m.installmentPortion), f(m.installmentExclVat), f(m.installmentVat)]).toEqual([
      '1515.87',
      '1416.74',
      '99.13',
    ]);
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

describe('receiptDocumentMoney — ใบที่เก็บค่า ณ ตอนออกใบ (PR3)', () => {
  const storedView = (o: Partial<ReceiptMoneyView> = {}): ReceiptMoneyView =>
    view({
      amount: D('2000'),
      amountBeforeVat: D('1869.16'),
      vatAmount: D('130.84'),
      roundingAmount: D('0'),
      lateFeeAmount: D('0'),
      lateFeeWaivedAmount: D('0'),
      advanceAmount: D('484.17'),
      advanceVatAmount: D('31.67'),
      installmentNo: 1,
      installmentAllocations: null, // ค่าที่เก็บไม่ต้องพึ่งประวัติ — ไม่ปฏิเสธแม้ประวัติแยกไม่ได้
      ...o,
    });

  it('เก็บครบ 7 ช่อง → พิมพ์ค่าที่เก็บ: แถวค่างวด 1,515.83 (99.17) + แถวเงินรับล่วงหน้า 484.17 (31.67)', () => {
    const m = receiptDocumentMoney(storedView());

    expect(hasStoredReceiptTax(storedView())).toBe(true);
    expect([f(m.installmentPortion), f(m.installmentExclVat), f(m.installmentVat)]).toEqual([
      '1515.83',
      '1416.66',
      '99.17',
    ]);
    expect(m.advanceRows.map((r) => [r.kind, f(r.amount), f(r.beforeVat), f(r.vat)])).toEqual([
      ['GENERIC', '484.17', '452.50', '31.67'],
    ]);
    expect([f(m.exclVat), f(m.vatPart), f(m.rounding)]).toEqual(['1869.16', '130.84', '0.00']);
  });

  it('เงินพักค่าปรับดิว (ประวัติบอกงวดเป้าหมาย) → ป้ายแถวเป็นงวดเป้าหมาย ตัวเลขยังมาจากค่าที่เก็บ', () => {
    const m = receiptDocumentMoney(
      storedView({
        installmentAllocations: [
          { installmentNo: 1, amount: '1515.83', kind: 'INSTALLMENT' },
          { installmentNo: 12, amount: '484.17', kind: 'RESCHEDULE_ADVANCE' },
        ],
      }),
    );

    expect(m.advanceRows.map((r) => [r.kind, r.installmentNo, f(r.vat)])).toEqual([
      ['RESCHEDULE', 12, '31.67'],
    ]);
  });

  it('หักเงินรับล่วงหน้า → แถว DEDUCTION ติดลบ · แถวค่างวดเต็มยอดที่ล้าง', () => {
    const m = receiptDocumentMoney(
      storedView({
        amount: D('1015.83'),
        amountBeforeVat: D('949.37'),
        vatAmount: D('66.46'),
        advanceAmount: D('-500'),
        advanceVatAmount: D('-32.71'),
      }),
    );

    expect(f(m.installmentPortion)).toBe('1515.83');
    expect(f(m.installmentVat)).toBe('99.17');
    expect(m.advanceRows.map((r) => [r.kind, f(r.amount), f(r.beforeVat), f(r.vat)])).toEqual([
      ['DEDUCTION', '-500.00', '-467.29', '-32.71'],
    ]);
  });

  it('เก็บไม่ครบ (ใบลดหนี้อัตโนมัติที่มีแค่ amountBeforeVat/vatAmount) → ตรรกะเดิม', () => {
    const cn = view({
      receiptType: 'CREDIT_NOTE',
      amount: D('4547.49'),
      amountBeforeVat: D('4249.98'),
      vatAmount: D('297.51'),
      installmentAllocations: null,
    });

    expect(hasStoredReceiptTax(cn)).toBe(false);
    const m = receiptDocumentMoney(cn);
    expect([f(m.exclVat), f(m.vatPart)]).toEqual(['4249.98', '297.51']);
  });
});

describe('documentMoneyColumns — ค่าที่ใบลดหนี้คัดลอก (Q5)', () => {
  it('ใบเก่า 3,050 (ตรรกะเดิม) → 2,803.74 / 196.26 / ค่าปรับ 50 · ผลรวมเท่ายอดใบ', () => {
    const cols = documentMoneyColumns(
      legacyReceiptDocumentMoney(
        view({
          amount: D('3050'),
          installmentNo: 2,
          lateFeeCollected: '50.00',
          installmentAllocations: [{ installmentNo: 2, amount: '3000.00', kind: 'INSTALLMENT' }],
        }),
      ),
    );

    expect(Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, f(v)]))).toEqual({
      amountBeforeVat: '2803.74',
      vatAmount: '196.26',
      roundingAmount: '0.00',
      lateFeeAmount: '50.00',
      lateFeeWaivedAmount: '0.00',
      advanceAmount: '0.00',
      advanceVatAmount: '0.00',
    });
  });

  it('ใบเก่า 5,516 (มีเงินพักค่าปรับดิว) → รวมแถวเงินพัก 1,044 (VAT 68.30) ในค่าที่คัดลอก', () => {
    const cols = documentMoneyColumns(legacyReceiptDocumentMoney(view()));

    expect([f(cols.amountBeforeVat), f(cols.vatAmount)]).toEqual(['5155.14', '360.86']);
    expect([f(cols.advanceAmount), f(cols.advanceVatAmount)]).toEqual(['1044.00', '68.30']);
  });

  it('ใบลดหนี้ของใบ 5,516 (ค่าที่คัดลอก + งวดเป้าหมายจากใบที่ถูกยกเลิก) → แถวเงินพักป้าย "งวดที่ 10 — ปรับดิว" เท่าใบเดิม ไม่ใช่ "เงินรับล่วงหน้าในสัญญา"', () => {
    const original = legacyReceiptDocumentMoney(view());
    const creditNote = view({
      receiptType: 'CREDIT_NOTE',
      installmentAllocations: null, // ใบลดหนี้ไม่มีประวัติการจัดสรรของตัวเอง
      advanceTargetInstallmentNo: 10, // ReceiptQueryService.getReceipt หาจากใบที่ถูกยกเลิก
      ...documentMoneyColumns(original),
    });

    const m = receiptDocumentMoney(creditNote);
    const rows = (x: typeof m) =>
      x.advanceRows.map((r) => [r.kind, r.installmentNo, f(r.amount), f(r.vat)]);
    expect(rows(m)).toEqual(rows(original));
    expect(rows(m)).toEqual([['RESCHEDULE', 10, '1044.00', '68.30']]);
    expect([f(m.exclVat), f(m.vatPart)]).toEqual(['5155.14', '360.86']);
  });
});
