import { Decimal } from '@prisma/client/runtime/library';
import { Accrual2ABasis } from './build-accrual-2a-lines';
import {
  ReceiptTaxBreakdown,
  advanceVatOf,
  computeInstallmentReceiptTax,
  documentedSoFar,
  parseReceiptTax,
  receiptTaxColumns,
} from './receipt-tax-breakdown';
import { splitReceipt } from './split-receipt';

/**
 * ใบกำกับภาษีตามบัญชี (PR3 — คำตัดสินฝ่ายบัญชี D3–D5 · คำถาม Q4–Q5). ยอดของใบมาจาก splitReceipt ตัวจริง —
 * ตัวเดียวกับที่ PaymentReceiptTemplate ใช้ลงบัญชี — เพื่อปักว่าเอกสารอ่านค่าชุดเดียวกับรายการบัญชี.
 */
const D = (v: string) => new Decimal(v);

/** งวด 6,078.67 = ก่อนภาษี 5,681.00 (ดอกเบี้ย 2,392.00) + ภาษี 397.67 — ตัวอย่างในเอกสารฝ่ายบัญชี */
const BASIS_6078: Accrual2ABasis = {
  installmentTotal: D('6078.67'),
  installmentExclVat: D('5681.00'),
  vatPerInst: D('397.67'),
  interestPerInst: D('2392.00'),
};
/** สัญญามาตรฐาน 17,000/12 งวด 1–11 */
const BASIS_17K: Accrual2ABasis = {
  installmentTotal: D('1515.83'),
  installmentExclVat: D('1416.66'),
  vatPerInst: D('99.17'),
  interestPerInst: D('500.00'),
};
/** สัญญามาตรฐาน 17,000/12 งวด 12 (รับเศษปัด) */
const BASIS_17K_LAST: Accrual2ABasis = {
  installmentTotal: D('1515.87'),
  installmentExclVat: D('1416.74'),
  vatPerInst: D('99.13'),
  interestPerInst: D('500.00'),
};

const receipt = (o: {
  basis: Accrual2ABasis;
  delta: string;
  prior?: string[];
  lateFee?: string;
  lateFeeWaived?: string;
  advanceConsume?: string;
  advanceCredit?: string;
  isFinalReceipt: boolean;
}) => {
  const prior = (o.prior ?? []).map(D);
  const split = splitReceipt({
    delta: D(o.delta),
    installmentTotal: o.basis.installmentTotal,
    lateFee: D(o.lateFee ?? '0'),
    priorPrincipalCleared: prior.reduce((s, v) => s.plus(v), D('0')),
    priorLateFeeBooked: D('0'),
    advanceConsume: D(o.advanceConsume ?? '0'),
    advanceCredit: D(o.advanceCredit ?? '0'),
    isFinalReceipt: o.isFinalReceipt,
  });
  return computeInstallmentReceiptTax({
    basis: o.basis,
    priorClearings: prior,
    delta: D(o.delta),
    split,
    lateFeeWaived: D(o.lateFeeWaived ?? '0'),
    advanceConsume: D(o.advanceConsume ?? '0'),
    advanceCredit: D(o.advanceCredit ?? '0'),
  });
};

/** ผลรวมของเอกสารต้องเท่าเงินที่รับเสมอ */
const expectBalanced = (b: ReceiptTaxBreakdown) =>
  expect(
    D(b.amountBeforeVat).plus(b.vatAmount).plus(b.roundingAmount).plus(b.lateFeeAmount).toFixed(2),
  ).toBe(b.amount);

describe('computeInstallmentReceiptTax — ตัวเลขทองของฝ่ายบัญชี (D3–D5)', () => {
  it('จ่ายเต็ม 6,079.00 ของงวด 6,078.67 → มูลค่า 5,681.00 · VAT 397.67 · ปัดเศษ 0.33', () => {
    const out = receipt({ basis: BASIS_6078, delta: '6079', isFinalReceipt: true });

    expect(out.breakdown).toEqual({
      version: 1,
      amount: '6079.00',
      amountBeforeVat: '5681.00',
      vatAmount: '397.67',
      roundingAmount: '0.33',
      lateFeeAmount: '0.00',
      lateFeeWaivedAmount: '0.00',
      advanceAmount: '0.00',
      advanceVatAmount: '0.00',
    });
    expect(out.installmentVat.toFixed(2)).toBe('397.67');
    expectBalanced(out.breakdown);
  });

  it('แบ่งจ่าย 3,079 แล้ว 3,000 (ค่างวด 2,999.67 + ปัดเศษ 0.33) → VAT 201.43 และ 196.24 · รวม 397.67 = VAT ของงวด', () => {
    const first = receipt({ basis: BASIS_6078, delta: '3079', isFinalReceipt: false });
    const second = receipt({
      basis: BASIS_6078,
      delta: '3000',
      prior: ['3079'],
      isFinalReceipt: true,
    });

    expect(first.breakdown.vatAmount).toBe('201.43'); // HALF_UP(3,079 × 7/107 = 201.4299…)
    expect(first.breakdown.amountBeforeVat).toBe('2877.57');
    expect(first.breakdown.roundingAmount).toBe('0.00');
    expect(second.breakdown.vatAmount).toBe('196.24'); // 397.67 − 201.43
    expect(second.breakdown.amountBeforeVat).toBe('2803.43'); // 2,999.67 − 196.24
    expect(second.breakdown.roundingAmount).toBe('0.33');
    expect(D(first.breakdown.vatAmount).plus(second.breakdown.vatAmount).toFixed(2)).toBe('397.67');
    expect(
      D(first.breakdown.amountBeforeVat).plus(second.breakdown.amountBeforeVat).toFixed(2),
    ).toBe('5681.00');
    expectBalanced(first.breakdown);
    expectBalanced(second.breakdown);
  });

  it('จ่ายขาดไม่เกิน 1 บาท (Q4): รับ 6,078.00 → VAT เต็มงวด 397.67 + ปัดเศษ −0.67', () => {
    const out = receipt({ basis: BASIS_6078, delta: '6078', isFinalReceipt: true });

    expect(out.breakdown.amountBeforeVat).toBe('5681.00');
    expect(out.breakdown.vatAmount).toBe('397.67');
    expect(out.breakdown.roundingAmount).toBe('-0.67');
    expect(out.breakdown.amount).toBe('6078.00');
    expectBalanced(out.breakdown);
  });

  it('ค่าปรับ: 3,050 = ค่างวด 3,000 + ค่าปรับ 50 → VAT 196.26 · ค่าปรับอยู่นอกฐานภาษี', () => {
    const out = receipt({ basis: BASIS_6078, delta: '3050', lateFee: '50', isFinalReceipt: false });

    expect(out.breakdown.vatAmount).toBe('196.26'); // HALF_UP(3,000 × 7/107) — ใบลดหนี้เดิมพิมพ์ 199.53
    expect(out.breakdown.amountBeforeVat).toBe('2803.74');
    expect(out.breakdown.lateFeeAmount).toBe('50.00');
    expectBalanced(out.breakdown);
  });

  it('อนุโลมค่าปรับ: ค่าปรับ 150 อนุโลม 100 → เก็บค่าปรับ 50 · เก็บยอดอนุโลม 100 ไว้พิมพ์แถวส่วนลด', () => {
    const out = receipt({
      basis: BASIS_6078,
      delta: '6128.67',
      lateFee: '50', // ยอดสุทธิ — template ส่ง gross − waived ให้ splitReceipt
      lateFeeWaived: '100',
      isFinalReceipt: true,
    });

    expect(out.breakdown.lateFeeAmount).toBe('50.00');
    expect(out.breakdown.lateFeeWaivedAmount).toBe('100.00');
    expect(out.breakdown.vatAmount).toBe('397.67');
    expectBalanced(out.breakdown);
  });
});

describe('computeInstallmentReceiptTax — กติกาเดียวกับบัญชี (7/107) ไม่ใช่สูตร V×x/T ในสเปค', () => {
  it('สัญญา 17,000/12: รับ 700.00 แล้ว 815.83 → VAT 45.79 และ 53.38 (สูตร V×x/T ให้ 45.80 และ 53.37)', () => {
    const first = receipt({ basis: BASIS_17K, delta: '700', isFinalReceipt: false });
    const second = receipt({
      basis: BASIS_17K,
      delta: '815.83',
      prior: ['700'],
      isFinalReceipt: true,
    });

    expect(first.breakdown.vatAmount).toBe('45.79'); // HALF_UP(700 × 7/107 = 45.7943…)
    expect(second.breakdown.vatAmount).toBe('53.38'); // 99.17 − 45.79
    // สูตรในสเปค (V × x / T) ต่างจากภาษีขายที่รายการตั้งลูกหนี้งวดลงจริง — แผนใช้ 7/107
    const specFormula = D('99.17')
      .times(700)
      .div('1515.83')
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(specFormula.toFixed(2)).toBe('45.80');
  });

  it('งวดสุดท้าย (1,515.87 · VAT 99.13): รับ 1,000 แล้ว 515.87 → VAT 65.42 และ 33.71', () => {
    const first = receipt({ basis: BASIS_17K_LAST, delta: '1000', isFinalReceipt: false });
    const second = receipt({
      basis: BASIS_17K_LAST,
      delta: '515.87',
      prior: ['1000'],
      isFinalReceipt: true,
    });

    expect(first.breakdown.vatAmount).toBe('65.42');
    expect(second.breakdown.vatAmount).toBe('33.71'); // 99.13 − 65.42
    expect(second.breakdown.amountBeforeVat).toBe('482.16');
  });

  it('ใบที่ไม่ได้ล้างลูกหนี้ของงวดเลย (รับเศษ 0.17 ที่เหลือของยอดเรียกเก็บ 1,516.00) → VAT 0 · ปัดเศษ 0.17', () => {
    const out = receipt({
      basis: BASIS_17K,
      delta: '0.17',
      prior: ['1515.83'],
      isFinalReceipt: true,
    });

    expect(out.breakdown.vatAmount).toBe('0.00');
    expect(out.breakdown.amountBeforeVat).toBe('0.00');
    expect(out.breakdown.roundingAmount).toBe('0.17');
    expectBalanced(out.breakdown);
  });
});

describe('computeInstallmentReceiptTax — เงินรับล่วงหน้า (ไม่แสดงภาษีซ้ำ — research §8.3)', () => {
  it('หักเงินรับล่วงหน้า 500 เข้างวดในใบเดียวกัน + เงินสด 1,015.83 → แถวค่างวด VAT 99.17 · แถวหัก −500.00 (VAT −32.71) · VAT สุทธิ 66.46', () => {
    const out = receipt({
      basis: BASIS_17K,
      delta: '1015.83',
      advanceConsume: '500',
      isFinalReceipt: true,
    });

    expect(out.installmentVat.toFixed(2)).toBe('99.17'); // = ภาษีขายของ 2A ที่ใบนี้ลง
    expect(out.breakdown.advanceAmount).toBe('-500.00');
    expect(out.breakdown.advanceVatAmount).toBe('-32.71'); // ภาษีที่ออกไปแล้วตอนรับเงินล่วงหน้า
    expect(out.breakdown.vatAmount).toBe('66.46');
    expect(out.breakdown.amountBeforeVat).toBe('949.37'); // 1,416.66 − 467.29
    expectBalanced(out.breakdown);
    // เอกสารของงวดนี้ทั้งหมด: 32.71 (ใบที่รับเงินล่วงหน้า) + 66.46 (ใบนี้) = 99.17 = ภาษีขายของงวด
    expect(D('32.71').plus(out.breakdown.vatAmount).toFixed(2)).toBe('99.17');
  });

  it('จ่าย 2,000 ของงวด 1,515.83 → พักเงินรับล่วงหน้า 484.17 (VAT 31.67) · VAT รวม 130.84', () => {
    const out = receipt({
      basis: BASIS_17K,
      delta: '2000',
      advanceCredit: '484.17',
      isFinalReceipt: true,
    });

    expect(out.installmentVat.toFixed(2)).toBe('99.17');
    expect(out.breakdown.advanceAmount).toBe('484.17');
    expect(out.breakdown.advanceVatAmount).toBe('31.67');
    expect(out.breakdown.vatAmount).toBe('130.84');
    expect(out.breakdown.amountBeforeVat).toBe('1869.16');
    expectBalanced(out.breakdown);
  });

  it('รอบกลางคืนหักเงินรับล่วงหน้า 300 เข้างวดไปก่อน แล้วลูกค้าจ่าย 1,215.83 → VAT 79.54 (= 99.17 − 19.63)', () => {
    const out = receipt({
      basis: BASIS_17K,
      delta: '1215.83',
      prior: ['300'], // รายการหักเงินรับล่วงหน้าของรอบกลางคืน (tag 2B · advance-consume-on-accrual)
      isFinalReceipt: true,
    });

    expect(out.breakdown.vatAmount).toBe('79.54');
    expect(out.breakdown.amountBeforeVat).toBe('1136.29');
  });

  it('ขอบ: เงินรับล่วงหน้าที่หักถูกปันไปจ่ายค่าปรับก่อน (ค่าปรับก่อนเสมอ) → ภาษีสุทธิของเอกสารติดลบได้ แต่ยอดรวมเท่าเงินที่รับ', () => {
    // ค้าง 100.00 ของงวด + ค่าปรับ 50 · เงินสด 10 · หักเงินรับล่วงหน้า 140
    const out = receipt({
      basis: BASIS_17K,
      delta: '10',
      prior: ['1415.83'],
      lateFee: '50',
      advanceConsume: '140',
      isFinalReceipt: true,
    });

    expect(out.installmentVat.toFixed(2)).toBe('6.55'); // 99.17 − 92.62
    expect(out.breakdown.advanceVatAmount).toBe('-9.16');
    expect(out.breakdown.vatAmount).toBe('-2.61');
    expect(out.breakdown.amountBeforeVat).toBe('-37.39');
    expect(out.breakdown.lateFeeAmount).toBe('50.00');
    expectBalanced(out.breakdown);
  });

  it('ขอบ (แจ้งเพื่อทราบ): เงินรับล่วงหน้า 500 ที่ถูกหักเข้างวดสองครั้ง 250 + 250 → ภาษีของแถวหักรวม 32.72 ต่างจาก 32.71 ที่พิมพ์ตอนรับ 0.01', () => {
    // ภาษีคิดทีละแถวด้วย HALF_UP — เงินก้อนเดียวที่ถูกหักหลายครั้งจึงเพี้ยนได้ ±0.01 ต่อก้อน
    const printedWhenReceived = advanceVatOf(D('500'));
    const deducted = advanceVatOf(D('-250')).plus(advanceVatOf(D('-250')));

    expect(printedWhenReceived.toFixed(2)).toBe('32.71');
    expect(deducted.toFixed(2)).toBe('-32.72');
  });
});

describe('computeInstallmentReceiptTax — ทุกลำดับการรับเงิน', () => {
  it('ทุกใบรวมกันแสดง VAT เท่าภาษีของงวดพอดี และทุกใบยอดรวมเท่าเงินที่รับ', () => {
    const sequences = [
      ['1515.83'],
      ['500', '600', '415.83'],
      ['0.01', '1515.82'],
      ['1515.82', '0.01'],
      ['333.33', '333.33', '333.33', '515.84'],
      ['1', '2', '3', '1509.83'],
    ];
    for (const seq of sequences) {
      const prior: string[] = [];
      let vat = D('0');
      seq.forEach((delta, i) => {
        const out = receipt({
          basis: BASIS_17K,
          delta,
          prior: [...prior],
          isFinalReceipt: i === seq.length - 1,
        });
        expectBalanced(out.breakdown);
        vat = vat.plus(out.breakdown.vatAmount);
        prior.push(delta);
      });
      expect(`${seq.join('+')} → ${vat.toFixed(2)}`).toBe(`${seq.join('+')} → 99.17`);
    }
  });
});

describe('documentedSoFar / advanceVatOf', () => {
  it('เล่นซ้ำกติกาเดียวกับรายการตั้งลูกหนี้งวดทีละรายการ', () => {
    const doc = documentedSoFar(BASIS_17K, [D('500'), D('600')]);

    expect(doc.amount.toFixed(2)).toBe('1100.00');
    expect(doc.vat.toFixed(2)).toBe('71.96'); // 32.71 + 39.25
  });

  it('ภาษีของเงินรับล่วงหน้ามีเครื่องหมายตามยอด', () => {
    expect(advanceVatOf(D('484.17')).toFixed(2)).toBe('31.67');
    expect(advanceVatOf(D('-500')).toFixed(2)).toBe('-32.71');
    expect(advanceVatOf(D('0')).toFixed(2)).toBe('0.00');
  });
});

describe('parseReceiptTax / receiptTaxColumns', () => {
  const VALID: ReceiptTaxBreakdown = {
    version: 1,
    amount: '6079.00',
    amountBeforeVat: '5681.00',
    vatAmount: '397.67',
    roundingAmount: '0.33',
    lateFeeAmount: '0.00',
    lateFeeWaivedAmount: '0.00',
    advanceAmount: '0.00',
    advanceVatAmount: '0.00',
  };

  it('อ่านค่าที่ประทับได้ครบ แล้วแปลงเป็นค่าของคอลัมน์', () => {
    const parsed = parseReceiptTax(JSON.parse(JSON.stringify(VALID)));

    expect(parsed).toEqual(VALID);
    const cols = receiptTaxColumns(parsed!);
    expect(cols.roundingAmount.toFixed(2)).toBe('0.33');
    expect(cols.vatAmount.toFixed(2)).toBe('397.67');
    expect(Object.keys(cols).sort()).toEqual([
      'advanceAmount',
      'advanceVatAmount',
      'amountBeforeVat',
      'lateFeeAmount',
      'lateFeeWaivedAmount',
      'roundingAmount',
      'vatAmount',
    ]);
  });

  it.each([
    ['ไม่มีค่า', undefined],
    ['รุ่นอื่น', { ...VALID, version: 2 }],
    ['ขาดช่อง', { ...VALID, roundingAmount: undefined }],
    ['ไม่ใช่ 2 ตำแหน่ง', { ...VALID, vatAmount: '397.670' }],
    ['ผลรวมไม่เท่ายอดรับ', { ...VALID, vatAmount: '397.68' }],
  ])('ค่าที่ใช้ไม่ได้ → null (%s)', (_label, value) => {
    expect(parseReceiptTax(value)).toBeNull();
  });
});
