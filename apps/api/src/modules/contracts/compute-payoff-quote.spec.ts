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

  /**
   * Golden 2 = ตารางที่เจ้าของส่งมา 2026-09-23 (สัญญาจริงสาขาลพบุรี — จอโปรแกรมได้
   * 17,717.97 แต่ที่ถูกต้องคือ 18,135.85):
   *
   *   ยอดค้าง 3,671 × 7 งวด               25,697.00
   *   หัก ค่าปรับดิว (ถังพัก)                1,714.00   ← "ต้องนำไปหักก่อน"
   *   ยอดค้างชำระ                          23,983.00
   *   ยอดค้าง ไม่ VAT (1)                   22,414.02   = 23,983 ÷ 1.07
   *   ต้นทุน (2) "45%"                     10,719.72   = ต้นทุนต่องวด × (23,983 ÷ 3,671 งวด)
   *   (1) − (2)                            11,694.30
   *   ลด 50%                                5,847.15
   *   ยอดปิดชำระ                           18,135.85
   *
   * ต้นทุนของเจ้าของไม่ใช่ 45% ตายตัว — 11,485.83 ÷ 25,697 = 10,719.72 ÷ 23,983 =
   * 44.697% คือ "ต้นทุนต่อบาทของยอดค้าง" เท่าเดิม ⇒ ค่าปรับดิวที่พักไว้ถูกมองเป็น
   * เงินที่จ่ายงวดล่วงหน้าไปแล้ว (เศษงวด 1,714 ÷ 3,671 = 0.467 งวด) จึงลดทั้งยอดค้าง
   * และต้นทุนตามสัดส่วน เหมือนงวดที่จ่ายแล้วทุกประการ.
   */
  const ownerCase20260923 = () => ({
    ...prodCaseInput(),
    remainingMonths: 7,
    payments: makeProdCasePayments().map((p, i) =>
      i < 5 ? { ...p, status: 'PAID', amountPaid: decimal(3671), lateFee: decimal(0) } : { ...p, lateFee: decimal(0) },
    ),
    rescheduleAdvanceBalance: decimal(1714),
  });

  describe('golden: ตารางเจ้าของ 2026-09-23 (ค่าปรับดิวต้องหักก่อนคิดฐานส่วนลด)', () => {
    it('reproduces the owner spreadsheet exactly', () => {
      const q = computePayoffQuote(ownerCase20260923());

      expect(q.totalRemaining).toBe(25697);
      expect(q.advancePayment).toBe(0);
      expect(q.rescheduleAdvanceApplied).toBe(1714); // หักเต็มจำนวน ไม่มีเศษค้าง
      expect(q.remainingBalance).toBe(23983); // 25697 − 1714 — หักก่อน
      expect(q.remainingExVat).toBe(22414.02);
      expect(q.remainingCost).toBe(10719.72); // ไม่ใช่ 11485.83 (7 งวดเต็ม)
      expect(q.grossProfit).toBe(11694.3);
      expect(q.discountAmount).toBe(5847.15);
      expect(q.payoffBeforeLateFees).toBe(18135.85);
      expect(q.totalPayoff).toBe(18135.85); // ไม่ใช่ 17717.97 (สูตรเดิมหักหลังส่วนลด)
    });

    it('ไม่มีถังพัก → ตัวเลข 7 งวดเต็มตามจอเดิม (ต้นทุน 11,485.83 · ปิด 19,431.97)', () => {
      const q = computePayoffQuote({ ...ownerCase20260923(), rescheduleAdvanceBalance: decimal(0) });

      expect(q.remainingBalance).toBe(25697);
      expect(q.remainingExVat).toBe(24015.89);
      expect(q.remainingCost).toBe(11485.83);
      expect(q.grossProfit).toBe(12530.06);
      expect(q.discountAmount).toBe(6265.03);
      expect(q.totalPayoff).toBe(19431.97);
    });
  });

  describe('park-at-last-installment (owner directive 2026-08-16, สูตรหักก่อน 2026-09-23)', () => {
    it('omitting rescheduleAdvanceBalance behaves exactly as before (backward-compatible default 0)', () => {
      const q = computePayoffQuote(prodCaseInput());
      expect(q.advancePayment).toBe(0);
      expect(q.totalPayoff).toBe(33411.96); // same golden as the base case above
    });

    it('ถังพักแยกออกจาก advancePayment — creditBalance + PARTIALLY_PAID เท่านั้น', () => {
      const input = prodCaseInput();
      input.payments[0].status = 'PARTIALLY_PAID';
      input.payments[0].amountPaid = decimal(1000);
      const q = computePayoffQuote({
        ...input,
        creditBalance: decimal(500),
        rescheduleAdvanceBalance: decimal(354),
      });

      // 500 (creditBalance) + 1000 (PARTIALLY_PAID) = 1500 · ถังพัก 354 แยกบรรทัด
      // แต่หักออกจากยอดค้างก่อนคิดฐานส่วนลดเหมือนกัน (เจ้าของ 2026-09-23)
      expect(q.advancePayment).toBe(1500);
      expect(q.remainingBalance).toBe(42198); // 44052 − 1500 − 354
      expect(q.rescheduleAdvanceApplied).toBe(354); // หักเต็มจำนวน
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

    // คำสั่งเจ้าของ 2026-09-23 (แทนคำวินิจฉัยผู้สอบ 2026-08-26 ที่หักหลังส่วนลด):
    // ถังพักหักออกจากยอดค้าง **ก่อน** คิด ex-VAT/ต้นทุน/กำไร/ส่วนลด — ต้นทุนลด
    // ตามสัดส่วนงวดที่เงินพักครอบ (เหมือนงวดที่จ่ายแล้ว) ⇒ ฐานส่วนลดเล็กลง
    // ส่วนลดจึงเล็กลงด้วย แต่ถังพักยังถูกหักเต็มจำนวน ไม่มีเศษค้าง
    it('ถังพักหักเต็มจำนวนจากยอดค้างก่อนคิดส่วนลด — ต้นทุนลดตามสัดส่วน ไม่เหลือเศษ', () => {
      const withPark = computePayoffQuote({
        ...prodCaseInput(),
        rescheduleAdvanceBalance: decimal(354),
      });
      const without = computePayoffQuote(prodCaseInput());

      // ยอดค้างและต้นทุนลดตามสัดส่วนเดียวกัน (354 ÷ 3671 = 0.0964 งวด)
      expect(withPark.remainingBalance).toBe(43698); // 44052 − 354
      expect(withPark.remainingCost).toBe(19531.77); // 19690 × 43698 ÷ 44052
      expect(withPark.remainingExVat).toBe(40839.25); // 43698 ÷ 1.07
      // กำไร 21307.48 × 50% = 10653.74 (เล็กกว่า 10740.04 ตอนไม่มีถัง)
      expect(withPark.discountAmount).toBe(10653.74);
      expect(withPark.discountAmount).toBeLessThan(without.discountAmount);

      // 43698 − 10653.74 = 33044.26 (ไม่ใช่ 33311.96 − 354 = 32957.96 สูตรเดิม)
      expect(without.payoffBeforeLateFees).toBe(33311.96);
      expect(withPark.payoffBeforeLateFees).toBe(33044.26);

      // ถังพักถูกใช้เต็มจำนวน — ปลดหนี้ 21-1103 ทั้งก้อน ไม่มีเศษค้าง
      expect(withPark.rescheduleAdvanceApplied).toBe(354);
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
