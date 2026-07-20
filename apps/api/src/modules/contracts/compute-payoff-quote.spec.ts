import { Prisma } from '@prisma/client';
import { computePayoffQuote, PayoffQuotePaymentRow } from './compute-payoff-quote';

const decimal = (v: number | string) => new Prisma.Decimal(v);

/**
 * Golden case = สัญญาจริงที่ owner รายงาน 2026-07-20:
 * หน้า "ปิดสัญญาก่อนกำหนด" ได้ 33,411.96 แต่หน้า "คืนเครื่อง (ยึดคืน)" ได้
 * 30,476.77 — สาเหตุ: สูตรยึดคืนเดิมหักส่วนลดจากฐาน ex-VAT และเอาค่าปรับ
 * ไปหาร 1.07 + โดนส่วนลดด้วย. ทั้งสอง flow ต้องได้ 33,411.96 เท่ากัน.
 */
function makeProdCasePayments(): PayoffQuotePaymentRow[] {
  const rows: PayoffQuotePaymentRow[] = [];
  for (let i = 1; i <= 12; i++) {
    rows.push({
      status: i === 1 ? 'OVERDUE' : 'PENDING',
      amountPaid: decimal(0),
      lateFee: decimal(i === 1 ? 100 : 0),
      lateFeeWaived: false,
    });
  }
  return rows;
}

const prodCaseInput = () => ({
  monthlyPayment: decimal(3671),
  remainingMonths: 12,
  totalMonths: 12,
  creditBalance: decimal(0),
  vatPct: decimal(0.07),
  // ยอดจัดจริง + คอม = (22190 − 3000) + 500 = 19,690 (ตรง "ต้นทุนยอดค้างชำระ" ในจอ)
  sellingPrice: decimal(22190),
  downPayment: decimal(3000),
  storeCommission: decimal(500),
  discountPctInput: 50,
  payments: makeProdCasePayments(),
});

describe('computePayoffQuote', () => {
  describe('golden: prod case 2026-07-20 (ยึดคืนต้องเท่าปิดยอดก่อนกำหนด)', () => {
    it('reproduces the early-payoff screen figures exactly', () => {
      const q = computePayoffQuote(prodCaseInput());

      expect(q.totalRemaining).toBe(44052);
      expect(q.remainingBalance).toBe(44052);
      expect(q.remainingExVat).toBe(41170.09); // 44052 ÷ 1.07
      expect(q.remainingCost).toBe(19690);
      expect(q.grossProfit).toBe(21480.09);
      // 21480.09 × 50% = 10740.045 → ROUND_DOWN = 10740.04 (ไม่ใช่ 10740.05)
      expect(q.discountAmount).toBe(10740.04);
      expect(q.unpaidLateFees).toBe(100);
      // 44052 − 10740.04 + 100 — NOT 30,476.77 (ค่าจากสูตร ex-VAT เดิมที่ผิด)
      expect(q.totalPayoff).toBe(33411.96);
    });

    it('late fee is added whole: not VAT-divided, not discounted (discount 0%)', () => {
      const q = computePayoffQuote({ ...prodCaseInput(), discountPctInput: 0 });

      expect(q.discountAmount).toBe(0);
      // ยอดปิด = ยอดค้างเต็ม + ค่าปรับเต็มก้อน (ถ้าค่าปรับโดนหาร 1.07 จะได้ 44145.44)
      expect(q.totalPayoff).toBe(44152);
    });

    it('excludes waived late fees', () => {
      const input = prodCaseInput();
      input.payments[0].lateFeeWaived = true;
      const q = computePayoffQuote(input);

      expect(q.unpaidLateFees).toBe(0);
      expect(q.totalPayoff).toBe(33311.96);
    });
  });

  describe('discount policy', () => {
    it('clamps discountPctInput above 50 down to 50', () => {
      const q = computePayoffQuote({ ...prodCaseInput(), discountPctInput: 80 });
      expect(q.discountPercent).toBe(50);
      expect(q.totalPayoff).toBe(33411.96);
    });

    it('defaults to 50% when discountPctInput is null/undefined', () => {
      const q = computePayoffQuote({ ...prodCaseInput(), discountPctInput: undefined });
      expect(q.discountPercent).toBe(50);
      expect(q.totalPayoff).toBe(33411.96);
    });

    it('gives no discount when gross profit is negative (loss contract)', () => {
      // ต้นทุนสูงกว่ายอดค้าง ex-VAT → กำไรติดลบ → ส่วนลด 0 (ไม่ลดเพิ่ม ไม่บวกเพิ่ม)
      const q = computePayoffQuote({
        ...prodCaseInput(),
        sellingPrice: decimal(50000),
        downPayment: decimal(0),
      });
      expect(q.grossProfit).toBeLessThan(0);
      expect(q.discountAmount).toBe(0);
      expect(q.totalPayoff).toBe(44152); // ยอดค้างเต็ม + ค่าปรับ
    });
  });

  describe('advance credit + VAT edge cases', () => {
    it('subtracts creditBalance and PARTIALLY_PAID amounts as advance payment', () => {
      const input = prodCaseInput();
      input.payments[0].status = 'PARTIALLY_PAID';
      input.payments[0].amountPaid = decimal(1000);
      const q = computePayoffQuote({ ...input, creditBalance: decimal(500) });

      expect(q.advancePayment).toBe(1500);
      expect(q.remainingBalance).toBe(42552); // 44052 − 1500
    });

    it('skips VAT back-out when vatPct = 0', () => {
      const q = computePayoffQuote({ ...prodCaseInput(), vatPct: decimal(0) });
      expect(q.remainingExVat).toBe(q.remainingBalance);
    });
  });
});
