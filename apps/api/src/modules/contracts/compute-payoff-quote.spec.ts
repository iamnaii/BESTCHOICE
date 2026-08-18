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

  describe('park-at-last-installment (owner directive 2026-08-16)', () => {
    it('omitting rescheduleAdvanceBalance behaves exactly as before (backward-compatible default 0)', () => {
      const q = computePayoffQuote(prodCaseInput());
      expect(q.advancePayment).toBe(0);
      expect(q.totalPayoff).toBe(33411.96); // same golden as the base case above
    });

    it('nets rescheduleAdvanceBalance into advancePayment alongside creditBalance + PARTIALLY_PAID (customer credit — parked fee has nowhere left to relieve into once the contract closes)', () => {
      const input = prodCaseInput();
      input.payments[0].status = 'PARTIALLY_PAID';
      input.payments[0].amountPaid = decimal(1000);
      const q = computePayoffQuote({
        ...input,
        creditBalance: decimal(500),
        rescheduleAdvanceBalance: decimal(354),
      });

      // 500 (creditBalance) + 1000 (PARTIALLY_PAID) + 354 (park) = 1854
      expect(q.advancePayment).toBe(1854);
      expect(q.remainingBalance).toBe(42198); // 44052 − 1854
    });

    it('does NOT double count when rescheduleAdvanceBalance is 0 (explicit zero == omitted)', () => {
      const q1 = computePayoffQuote(prodCaseInput());
      const q2 = computePayoffQuote({ ...prodCaseInput(), rescheduleAdvanceBalance: decimal(0) });
      expect(q2.advancePayment).toBe(q1.advancePayment);
      expect(q2.totalPayoff).toBe(q1.totalPayoff);
    });
  });

  /**
   * `rescheduleAdvanceApplied` = ยอดถังพักที่ยอดปิด "ดูดซับจริง" — JP4/JP5 ใช้
   * เป็นขา `Dr 21-1103` (ปลดหนี้เงินพัก) เพื่อให้ขาเงินสดของ JE ขยับเท่ากับเงินที่
   * ลูกค้าจ่ายจริงพอดี (บั๊ก C-3: quote หักให้ แต่ ledger ไม่ปลดหนี้ → Dr เงินสดเกิน)
   */
  describe('rescheduleAdvanceApplied (ยอดที่ยอดปิดดูดซับจริง — ฐานของขา Dr 21-1103)', () => {
    it('เป็น 0 เมื่อไม่มีถังพัก', () => {
      expect(computePayoffQuote(prodCaseInput()).rescheduleAdvanceApplied).toBe(0);
      expect(
        computePayoffQuote({ ...prodCaseInput(), rescheduleAdvanceBalance: decimal(0) })
          .rescheduleAdvanceApplied,
      ).toBe(0);
    });

    it('ส่วนลด 0% → ดูดซับเต็มจำนวนถัง (ลูกค้าจ่ายน้อยลงเท่ายอดในถังพอดี)', () => {
      const withPark = computePayoffQuote({
        ...prodCaseInput(),
        discountPctInput: 0,
        rescheduleAdvanceBalance: decimal(354),
      });
      const without = computePayoffQuote({ ...prodCaseInput(), discountPctInput: 0 });

      expect(withPark.rescheduleAdvanceApplied).toBe(354);
      // ยอดที่ลูกค้าจ่ายลดลงเท่ากับยอดที่ดูดซับเป๊ะ ๆ
      expect(without.totalPayoff - withPark.totalPayoff).toBeCloseTo(354, 2);
    });

    it('ส่วนลด 50% → ดูดซับได้แค่บางส่วน (ถังพักลดฐานกำไร → ส่วนลดลดตาม) ที่เหลือค้างในถัง', () => {
      const withPark = computePayoffQuote({
        ...prodCaseInput(),
        rescheduleAdvanceBalance: decimal(354),
      });
      const without = computePayoffQuote(prodCaseInput());

      // 44052 − 354 = 43698 → ex-VAT 40839.25 → กำไร 21149.25 → ส่วนลด 10574.62
      // payoffBeforeLateFees = 43698 − 10574.62 = 33123.38 (ไม่มีถัง: 33311.96)
      expect(withPark.payoffBeforeLateFees).toBe(33123.38);
      expect(without.payoffBeforeLateFees).toBe(33311.96);
      expect(withPark.rescheduleAdvanceApplied).toBe(188.58); // 33311.96 − 33123.38
      expect(without.totalPayoff - withPark.totalPayoff).toBeCloseTo(188.58, 2);
      // ห้ามปลดหนี้ 21-1103 เกินกว่าที่ยอดปิดดูดซับ — ที่เหลือ 165.42 ค้างในถัง
      expect(withPark.rescheduleAdvanceApplied).toBeLessThan(354);
    });

    it('ถังพักใหญ่กว่ายอดค้าง → clamp ที่ยอดที่ดูดซับได้จริง (ยอดปิดชน 0 ไม่ติดลบ)', () => {
      const q = computePayoffQuote({
        ...prodCaseInput(),
        discountPctInput: 0,
        rescheduleAdvanceBalance: decimal(100000),
      });

      expect(q.payoffBeforeLateFees).toBe(0); // max(0, …) — ไม่ติดลบ
      expect(q.rescheduleAdvanceApplied).toBe(44052); // ยอดค้างทั้งหมด ไม่ใช่ 100000
      expect(q.rescheduleAdvanceApplied).toBeLessThan(100000);
    });

    it('ไม่เคยเกินยอดในถัง แม้ creditBalance/PARTIALLY_PAID จะดันยอดปิดชน 0 อยู่แล้ว', () => {
      const input = prodCaseInput();
      input.payments[0].status = 'PARTIALLY_PAID';
      input.payments[0].amountPaid = decimal(44052); // ปิดยอดหมดด้วย partial อยู่แล้ว
      const q = computePayoffQuote({
        ...input,
        discountPctInput: 0,
        rescheduleAdvanceBalance: decimal(354),
      });

      // ยอดปิดเป็น 0 อยู่แล้วก่อนมีถังพัก → ถังพักดูดซับอะไรไม่ได้เลย
      expect(q.rescheduleAdvanceApplied).toBe(0);
    });
  });
});
