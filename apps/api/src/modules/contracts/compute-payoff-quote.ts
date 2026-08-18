import { Prisma } from '@prisma/client';
import { d, dAdd, dSub, dMul, dDiv, dRound, dRoundDown, dSum } from '../../utils/decimal.util';

type DecimalInput = Prisma.Decimal | string | number | null | undefined;

/** Minimal payment-row shape needed by the quote math (subset of Payment). */
export interface PayoffQuotePaymentRow {
  status: string;
  amountPaid: DecimalInput;
  lateFee: DecimalInput;
  lateFeeWaived: boolean | null;
}

export interface PayoffQuoteInput {
  monthlyPayment: DecimalInput;
  /** จำนวนงวดที่ยังไม่มี Payment สถานะ PAID ครอบ (caller นับเอง — EP นับจาก schedule, ยึดคืนนับจาก payments) */
  remainingMonths: number;
  totalMonths: number;
  creditBalance: DecimalInput;
  /**
   * พักงวดสุดท้าย (Contract.rescheduleAdvanceBalance) — ค่าธรรมเนียมปรับดิว (6a/6b)
   * ที่พักรอหักงวดสุดท้าย (คำสั่งเจ้าของ 2026-08-16). ปิดสัญญาก่อนกำหนด/ยึดคืน = ลูกค้า
   * ไม่มีงวดสุดท้ายให้หักแล้ว จึงต้องคืนเป็นเครดิตหักยอดปิดสัญญาเช่นเดียวกับ creditBalance.
   * Optional — omit หรือ undefined = 0 (ค่าเดิม ไม่กระทบ caller ที่ยังไม่ส่งมา).
   */
  rescheduleAdvanceBalance?: DecimalInput;
  /** สัดส่วน VAT เช่น 0.07 (0 หรือ null = ไม่มี VAT) */
  vatPct: DecimalInput;
  sellingPrice: DecimalInput;
  downPayment: DecimalInput;
  storeCommission: DecimalInput;
  /** 0-50 (clamp), ไม่ส่ง = 50 */
  discountPctInput?: number | null;
  payments: PayoffQuotePaymentRow[];
}

export interface PayoffQuoteResult {
  totalRemaining: number;
  advancePayment: number;
  remainingBalance: number;
  remainingExVat: number;
  financeCost: number;
  remainingCost: number;
  grossProfit: number;
  /** ส่วนลดเป็นเปอร์เซ็นต์หลัง clamp (0-100 scale) */
  discountPercent: number;
  discountAmount: number;
  unpaidLateFees: number;
  payoffBeforeLateFees: number;
  totalPayoff: number;
  /**
   * ส่วนของถังพักงวดสุดท้าย (`rescheduleAdvanceBalance`) ที่ยอดปิดสัญญานี้
   * "ดูดซับจริง" = ยอดที่ลูกค้าจ่ายน้อยลงเพราะมีเงินพักอยู่
   *   = payoffBeforeLateFees(ไม่มีถังพัก) − payoffBeforeLateFees(มีถังพัก)
   *
   * ทำไมไม่ใช่ยอดถังพักเต็มจำนวน: ถังพักลด `remainingBalance` → ลดกำไรขั้นต้น →
   * **ส่วนลดลดตามไปด้วย** (ข้อ 6-7) และยังมี clamp `max(0, …)` ที่ข้อ 8 —
   * ยอดที่ลูกค้าจ่ายน้อยลงจริงจึงน้อยกว่าหรือเท่ากับยอดในถังเสมอ.
   *
   * JP4/JP5 ใช้ค่านี้เป็น "ยอดปลดหนี้ 21-1103" (Dr 21-1103) เพื่อให้ขาเงินสด
   * ของ JE ขยับเท่ากับเงินที่ลูกค้าจ่ายจริงพอดี — ส่วนที่เหลือในถัง (ถ้ามี)
   * ยังค้างอยู่ใน 21-1103 ตามเดิม ไม่ปลดเกินที่ยอดปิดดูดซับไป.
   */
  rescheduleAdvanceApplied: number;
}

/**
 * คำนวณยอดปิดสัญญา (FINANCE perspective) — SINGLE SOURCE OF TRUTH
 *
 * ใช้ร่วมกันโดย:
 *   A) ContractPaymentService.getEarlyPayoffQuote() — ปิดสัญญาก่อนกำหนด (JP4)
 *   B) RepossessionsService.previewCalculation() + create() — ยึดคืน (JP5)
 *
 * Owner rule 2026-07-20: ยอดปิดสัญญาตอนยึดคืนต้องเท่ากับยอดปิดสัญญาก่อนกำหนด
 * ของสัญญาเดียวกัน/ส่วนลดเดียวกันเสมอ — ห้าม copy สูตรนี้ไปแก้เฉพาะที่
 *
 * Logic:
 *   (1) รวมค้างชำระ      = ค่างวด × งวดคงเหลือ (รวม VAT)
 *   (2) ยอดชำระล่วงหน้า  = creditBalance + พักงวดสุดท้าย + Σ amountPaid ของงวด PARTIALLY_PAID
 *   (3) คงเหลือยอดค้าง   = (1) - (2)
 *   (4) ค่างวดไม่รวม VAT = (3) ÷ (1 + vatPct)
 *   (5) ต้นทุนยอดค้าง    = ((sellingPrice - downPayment) + storeCommission) ÷ totalMonths × งวดคงเหลือ
 *                          (ยอดจัดจริง + ค่าคอมที่ FINANCE จ่ายให้ SHOP, เฉลี่ยต่องวด —
 *                          ห้ามใช้ contract.financedAmount: field นั้นเก็บยอดรวมที่ลูกค้าต้องจ่าย)
 *   (6) กำไรขั้นต้น      = (4) - (5)
 *   (7) ส่วนลด           = (6) × discountPct, ปัดลง (ROUND_DOWN — เข้าข้าง FINANCE, owner 2026-07-02)
 *   (8) ยอดชำระปิดยอด    = max(0, (3) - (7)) + ค่าปรับค้างชำระ
 *                          (ค่าปรับไม่มี VAT และไม่ร่วมส่วนลด — บวกทั้งก้อนตอนท้าย)
 */
export function computePayoffQuote(input: PayoffQuoteInput): PayoffQuoteResult {
  const round2 = (v: Prisma.Decimal) => dRound(v).toNumber();
  const monthlyPayment = d(input.monthlyPayment);

  // (1) รวมค้างชำระ (รวม VAT)
  const totalRemaining = round2(dMul(monthlyPayment, input.remainingMonths));

  // (2) ยอดชำระล่วงหน้า / partial credit
  // + พักงวดสุดท้าย (rescheduleAdvanceBalance) — ลูกค้าไม่มีงวดสุดท้ายให้หักแล้ว
  // (ปิดก่อนกำหนด/ยึดคืน) จึงคืนเป็นเครดิตหักยอดปิดสัญญาเหมือน creditBalance
  // (คำสั่งเจ้าของ 2026-08-16). ไม่แตะ Contract.advanceBalance ทั่วไป — จุดนั้นเป็น
  // gap เดิมที่แยกออกจากงานนี้ (ดูรายงาน readers table).
  const partialPaid = dSum(
    input.payments.filter((p) => p.status === 'PARTIALLY_PAID').map((p) => d(p.amountPaid)),
  );
  const park = d(input.rescheduleAdvanceBalance ?? 0);
  const advancePayment = round2(dAdd(dAdd(d(input.creditBalance), park), partialPaid));
  /** ยอดชำระล่วงหน้าถ้า "ไม่มีถังพัก" — ใช้วัดว่ายอดปิดดูดซับถังพักไปเท่าไรจริง */
  const advancePaymentNoPark = round2(dAdd(d(input.creditBalance), partialPaid));

  // (5) ต้นทุนยอดค้าง = ยอดจัดจริง + commission (ไม่ขึ้นกับยอดชำระล่วงหน้า)
  const truePrincipal = dSub(input.sellingPrice, input.downPayment);
  const financeCost = dAdd(truePrincipal, d(input.storeCommission));
  const remainingCost = round2(dMul(dDiv(financeCost, input.totalMonths), input.remainingMonths));

  // (7) ส่วนลด (default 50%, max 50% ตามนโยบาย)
  const discountPercent =
    input.discountPctInput != null ? Math.max(0, Math.min(50, input.discountPctInput)) : 50;
  const vatPct = d(input.vatPct);

  /**
   * ข้อ (3)(4)(6)(7)(8) ทั้งชุด แยกเป็นฟังก์ชันเพื่อประเมิน 2 รอบ: รอบจริง
   * (มีถังพัก) และรอบเทียบ (ไม่มีถังพัก) — ผลต่างของ payoffBeforeLateFees คือ
   * "ยอดที่ถังพักดูดซับจริง" (ดู `rescheduleAdvanceApplied`). สูตรภายในเหมือนเดิม
   * ทุกบรรทัด — ไม่มีการเปลี่ยนวิธีคำนวณค่าเดิมแม้แต่ค่าเดียว.
   */
  const tail = (advance: number) => {
    // (3) คงเหลือยอดค้าง
    const remainingBalance = round2(dSub(totalRemaining, advance));

    // (4) ค่างวดไม่รวม VAT
    const remainingExVat = vatPct.gt(0)
      ? round2(dDiv(remainingBalance, dAdd(1, vatPct)))
      : remainingBalance;

    // (6) กำไรขั้นต้น (อาจติดลบเคสขาดทุน — แสดงค่าจริง)
    const grossProfit = round2(dSub(remainingExVat, remainingCost));

    // (7) ถ้ากำไรติดลบ → ส่วนลด = 0 (ไม่ลดเพิ่ม ไม่บวกเพิ่ม)
    const discountAmount =
      grossProfit > 0 ? dRoundDown(dMul(grossProfit, discountPercent / 100)).toNumber() : 0;

    // (8) ยอดชำระปิดยอดก่อนบวกค่าปรับ
    const payoffBeforeLateFees = Math.max(0, round2(dSub(remainingBalance, discountAmount)));

    return { remainingBalance, remainingExVat, grossProfit, discountAmount, payoffBeforeLateFees };
  };

  const main = tail(advancePayment);
  const { remainingBalance, remainingExVat, grossProfit, discountAmount, payoffBeforeLateFees } =
    main;

  // (8) ยอดชำระปิดยอด — ค่าปรับบวกทั้งก้อน (ไม่คิด VAT ไม่ลด ตามนโยบาย)
  const unpaidLateFees = dSum(
    input.payments.filter((p) => p.status !== 'PAID' && !p.lateFeeWaived).map((p) => d(p.lateFee)),
  ).toNumber();
  const totalPayoff = round2(dAdd(payoffBeforeLateFees, unpaidLateFees));

  // ยอดที่ถังพักดูดซับจริง — ค่าปรับเท่ากันทั้งสองรอบ จึงเทียบที่
  // payoffBeforeLateFees ได้ตรง ๆ. clamp [0, ยอดในถัง] กันเคสมุม (ถังพัก 0,
  // ส่วนลดชนขอบ, remainingBalance ติดลบจนโดน max(0,…))
  const noPark = park.gt(0) ? tail(advancePaymentNoPark) : main;
  const rescheduleAdvanceApplied = Math.min(
    Math.max(0, round2(dSub(noPark.payoffBeforeLateFees, payoffBeforeLateFees))),
    round2(park),
  );

  return {
    totalRemaining,
    advancePayment,
    remainingBalance,
    remainingExVat,
    financeCost: round2(financeCost),
    remainingCost,
    grossProfit,
    discountPercent,
    discountAmount,
    unpaidLateFees,
    payoffBeforeLateFees,
    totalPayoff,
    rescheduleAdvanceApplied,
  };
}
