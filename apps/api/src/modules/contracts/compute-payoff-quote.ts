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
 *   (2) ยอดชำระล่วงหน้า  = creditBalance + Σ amountPaid ของงวด PARTIALLY_PAID
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
  const partialPaid = dSum(
    input.payments.filter((p) => p.status === 'PARTIALLY_PAID').map((p) => d(p.amountPaid)),
  );
  const advancePayment = round2(dAdd(d(input.creditBalance), partialPaid));

  // (3) คงเหลือยอดค้าง
  const remainingBalance = round2(dSub(totalRemaining, advancePayment));

  // (4) ค่างวดไม่รวม VAT
  const vatPct = d(input.vatPct);
  const remainingExVat = vatPct.gt(0)
    ? round2(dDiv(remainingBalance, dAdd(1, vatPct)))
    : remainingBalance;

  // (5) ต้นทุนยอดค้าง = ยอดจัดจริง + commission
  const truePrincipal = dSub(input.sellingPrice, input.downPayment);
  const financeCost = dAdd(truePrincipal, d(input.storeCommission));
  const remainingCost = round2(dMul(dDiv(financeCost, input.totalMonths), input.remainingMonths));

  // (6) กำไรขั้นต้น (อาจติดลบเคสขาดทุน — แสดงค่าจริง)
  const grossProfit = round2(dSub(remainingExVat, remainingCost));

  // (7) ส่วนลด (default 50%, max 50% ตามนโยบาย)
  // ถ้ากำไรติดลบ → ส่วนลด = 0 (ไม่ลดเพิ่ม ไม่บวกเพิ่ม)
  const discountPercent =
    input.discountPctInput != null ? Math.max(0, Math.min(50, input.discountPctInput)) : 50;
  const discountAmount =
    grossProfit > 0 ? dRoundDown(dMul(grossProfit, discountPercent / 100)).toNumber() : 0;

  // (8) ยอดชำระปิดยอด — ค่าปรับบวกทั้งก้อน (ไม่คิด VAT ไม่ลด ตามนโยบาย)
  const unpaidLateFees = dSum(
    input.payments
      .filter((p) => p.status !== 'PAID' && !p.lateFeeWaived)
      .map((p) => d(p.lateFee)),
  ).toNumber();
  const payoffBeforeLateFees = Math.max(0, round2(dSub(remainingBalance, discountAmount)));
  const totalPayoff = round2(dAdd(payoffBeforeLateFees, unpaidLateFees));

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
  };
}
