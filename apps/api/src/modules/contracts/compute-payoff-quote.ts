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
  /**
   * เงินรับล่วงหน้าถังรวม (Contract.advanceBalance — 21-1103) — เงินที่ลูกค้าจ่ายเกินงวดก่อน รอหักงวดถัดไป.
   * เจ้าของเคาะ 01/10/2569 (PR5ข): ปิดสัญญาก่อนกำหนด/ยึดคืน หักแบบเดียวกับเงินพักค่าปรับดิว — หักจากยอดค้าง
   * ก่อนคิดส่วนลด และลดต้นทุนตามสัดส่วนงวดที่เงินครอบ. Optional — omit = 0 (ค่าเดิม).
   */
  advanceBalance?: DecimalInput;
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
   * ส่วนของถังพักงวดสุดท้าย (`rescheduleAdvanceBalance`) ที่ถูกหักออกจากยอดค้าง
   * ในการปิดสัญญานี้ = ยอดถังพัก **เต็มจำนวน** clamp ไม่ให้เกินยอดค้างหลังหัก
   * ยอดชำระล่วงหน้า (`totalRemaining − advancePayment`).
   *
   * คำสั่งเจ้าของ 2026-09-23: ค่าปรับดิวที่พักไว้ "ต้องนำไปหักก่อน" — หักออกจาก
   * ยอดค้าง (ข้อ 2b) ก่อนคิด ex-VAT/ต้นทุน/กำไร/ส่วนลด ไม่ใช่บรรทัดท้ายสุด.
   * ลูกค้าจึงจ่ายน้อยลง **น้อยกว่า** ยอดถัง (ส่วนลดเล็กลงตามฐานกำไรที่เล็กลง)
   * แต่ถังพักถูกใช้หมดทั้งก้อน ไม่มีเศษค้างใน 21-1103.
   *
   * JP4/JP5 ใช้ค่านี้เป็น "ยอดปลดหนี้ 21-1103" (Dr 21-1103) — ขาเงินสดของ JE
   * ลดลงเท่ากัน ยอด Dr รวมเท่าเดิม ทุกขา Cr ไม่ขยับ.
   */
  rescheduleAdvanceApplied: number;
  /**
   * ส่วนของเงินรับล่วงหน้าถังรวม (`advanceBalance`) ที่ถูกหักออกจากยอดค้างในการปิดสัญญานี้ (PR5ข — เจ้าของเคาะ
   * 01/10/2569 "หักแบบเดียวกับเงินพักค่าปรับดิว") = ยอดถังรวมเต็มจำนวน clamp ไม่ให้เกินยอดค้างที่เหลือหลังหักยอดชำระ
   * ล่วงหน้าและเงินพัก (เงินพักหักก่อน ⇒ `rescheduleAdvanceApplied` เท่าเดิมทุกกรณี). ส่วนที่ยอดค้างรับไม่หมดคงค้าง
   * ในถังรวม. JP4 ใช้ค่านี้เป็นบรรทัด Dr 21-1103 ของถังรวม (แยกจากบรรทัดเงินพัก) · JP5 ล้าง 21-1103 ทั้งยอดในบัญชีอยู่แล้ว.
   */
  advanceBalanceApplied: number;
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
 * Logic (คำสั่งเจ้าของ 2026-09-23 — ค่าปรับดิวที่พักไว้ "ต้องนำไปหักก่อน" · 01/10/2569 — ถังรวมหักแบบเดียวกัน):
 *   (1) รวมค้างชำระ      = ค่างวด × งวดคงเหลือ (รวม VAT)
 *   (2) ยอดชำระล่วงหน้า  = creditBalance + Σ amountPaid ของงวด PARTIALLY_PAID
 *   (2b) ค่าปรับดิวพัก   = min(rescheduleAdvanceBalance, (1) − (2)) — หักเต็มจำนวน
 *   (2c) ถังรวม          = min(advanceBalance, (1) − (2) − (2b)) — หักเต็มจำนวน (PR5ข · เงินพักหักก่อน)
 *   (3) คงเหลือยอดค้าง   = (1) - (2) - (2b) - (2c)
 *   (4) ค่างวดไม่รวม VAT = (3) ÷ (1 + vatPct)
 *   (5) ต้นทุนยอดค้าง    = ((sellingPrice - downPayment) + storeCommission) ÷ totalMonths × งวดคงเหลือสุทธิ
 *                          งวดคงเหลือสุทธิ = งวดคงเหลือ − ((2b) + (2c)) ÷ ค่างวด
 *                          (ยอดจัดจริง + ค่าคอมที่ FINANCE จ่ายให้ SHOP, เฉลี่ยต่องวด —
 *                          ห้ามใช้ contract.financedAmount: field นั้นเก็บยอดรวมที่ลูกค้าต้องจ่าย
 *                          · ค่าปรับดิวพัก = เงินจ่ายงวดล่วงหน้า (CPA CSV 6a/6b) จึงลดต้นทุน
 *                          ตามสัดส่วนงวดเหมือนงวดที่จ่ายแล้ว — ตารางเจ้าของ "ต้นทุน 45%"
 *                          = ต้นทุนต่อบาทของยอดค้างเท่าเดิมทั้งก่อน/หลังหัก · ถังรวมแบบเดียวกัน)
 *   (6) กำไรขั้นต้น      = (4) - (5)
 *   (7) ส่วนลด           = (6) × discountPct, ปัดลง (ROUND_DOWN — เข้าข้าง FINANCE, owner 2026-07-02)
 *   (8) ยอดชำระปิดยอด    = max(0, (3) - (7)) + ค่าปรับค้างชำระ
 *                          (ค่าปรับไม่มี VAT และไม่ร่วมส่วนลด — บวกทั้งก้อนตอนท้าย)
 *
 * ประวัติ: 2026-08-26 ผู้สอบให้สูตร `ยอดปิดจริง = ยอดปิดปกติ − 21-1103` (หักถังพัก
 * เป็นบรรทัดท้ายสุด ไม่ลดฐานส่วนลด) — เจ้าของสั่งเปลี่ยน 2026-09-23 ให้หักก่อน
 * ตามตารางที่ส่งมา (สัญญาจริง 3,671 × 7 งวด พัก 1,714 → 18,135.85 ไม่ใช่ 17,717.97).
 * ถังพักยังถูกใช้เต็มจำนวนเหมือนเดิม (ไม่มีเศษค้าง) — ต่างกันเฉพาะฐานส่วนลด.
 * 01/10/2569 (PR5ข): เงินรับล่วงหน้าถังรวมเดิมไม่ถูกหัก (ลูกค้าจ่ายเต็ม · เงินค้างเป็นของลูกค้าหลังปิดสัญญา) — เจ้าของเคาะ
 * "หักแบบเดียวกับเงินพักค่าปรับดิว" (17,000/12 · เครดิต 300 + ถังรวม 500 · ลด 50%: 15,030.17 → 14,612.63).
 */
export function computePayoffQuote(input: PayoffQuoteInput): PayoffQuoteResult {
  const round2 = (v: Prisma.Decimal) => dRound(v).toNumber();
  const monthlyPayment = d(input.monthlyPayment);

  // (1) รวมค้างชำระ (รวม VAT)
  const totalRemaining = round2(dMul(monthlyPayment, input.remainingMonths));

  // (2) ยอดชำระล่วงหน้า / partial credit
  // + พักงวดสุดท้าย (rescheduleAdvanceBalance) — ลูกค้าไม่มีงวดสุดท้ายให้หักแล้ว
  // (ปิดก่อนกำหนด/ยึดคืน) จึงคืนเป็นเครดิตหักยอดปิดสัญญาเหมือน creditBalance
  // (คำสั่งเจ้าของ 2026-08-16). Contract.advanceBalance (ถังรวม) หักใน (2c) — PR5ข.
  const partialPaid = dSum(
    input.payments.filter((p) => p.status === 'PARTIALLY_PAID').map((p) => d(p.amountPaid)),
  );
  // ⚠️ **ไม่รวมถังพัก** ใน advancePayment — UI แสดงถังพักเป็นบรรทัดของตัวเอง
  // ("หักค่าปรับดิวที่จ่ายล่วงหน้าไว้") ระหว่าง "ยอดชำระล่วงหน้า" กับ "คงเหลือยอดค้าง"
  // และ JP4/JP5 ใช้ยอดนี้เป็นขา Dr 21-1103 แยกจากเครดิตทั่วไป
  const advancePayment = round2(dAdd(d(input.creditBalance), partialPaid));

  // (2b) ค่าปรับดิวที่พักไว้ — หักเต็มจำนวน clamp ไม่เกินยอดค้างที่เหลือหลังหัก
  // ยอดชำระล่วงหน้า (ยอดค้างชน 0 อยู่แล้ว ⇒ ถังพักดูดซับอะไรไม่ได้ · ส่วนเกิน
  // คงค้างใน 21-1103 ต่อไป · JP4/JP5 หักเงินพักเท่าที่ยอดนี้ดูดซับ clamp ด้วยยอดในบัญชีอีกชั้น)
  const balanceBeforePark = dSub(totalRemaining, advancePayment);
  const rescheduleAdvanceApplied = Prisma.Decimal.max(
    0,
    Prisma.Decimal.min(dRound(d(input.rescheduleAdvanceBalance ?? 0)), balanceBeforePark),
  ).toNumber();

  // (2c) เงินรับล่วงหน้าถังรวม — เจ้าของเคาะ 01/10/2569 (PR5ข) "หักแบบเดียวกับเงินพักค่าปรับดิว": หักเต็มจำนวน
  // clamp ไม่เกินยอดค้างที่เหลือหลังหักเงินพัก (เงินพักหักก่อน ⇒ rescheduleAdvanceApplied เท่าเดิมทุกกรณี · ส่วนเกิน
  // คงค้างในถังรวม / 21-1103 · JP4 หักเท่าที่ยอดนี้ดูดซับ clamp ด้วยคอลัมน์และยอดในบัญชีอีกชั้น)
  const balanceAfterPark = dSub(balanceBeforePark, rescheduleAdvanceApplied);
  const advanceBalanceApplied = Prisma.Decimal.max(
    0,
    Prisma.Decimal.min(dRound(d(input.advanceBalance ?? 0)), balanceAfterPark),
  ).toNumber();

  // (3) คงเหลือยอดค้าง — คำสั่งเจ้าของ 2026-09-23: ค่าปรับดิว "ต้องนำไปหักก่อน" (ถังรวมเช่นเดียวกัน — PR5ข)
  // ทุกบรรทัดถัดจากนี้ (ex-VAT / ต้นทุน / กำไร / ส่วนลด) คิดจากยอดหลังหักแล้ว
  const remainingBalance = round2(dSub(balanceAfterPark, advanceBalanceApplied));

  // (5) ต้นทุนยอดค้าง = ยอดจัดจริง + commission เฉลี่ยต่องวด × งวดคงเหลือสุทธิ
  // ค่าปรับดิวพัก = เงินจ่ายงวดล่วงหน้า (CPA CSV 6a/6b) ⇒ นับเป็นเศษงวดที่จ่ายแล้ว
  // (1,714 ÷ 3,671 = 0.467 งวด) ลดต้นทุนตามสัดส่วนเหมือนงวด PAID — ตรงตาราง
  // เจ้าของที่ "ต้นทุน 45%" ของยอดค้างคงที่ทั้งก่อน/หลังหัก · ถังรวมลดต้นทุนแบบเดียวกัน (PR5ข). เครดิตทั่วไป
  // (advancePayment) ยังไม่ลดต้นทุนเหมือนเดิม — ไม่อยู่ในคำสั่งนี้
  const truePrincipal = dSub(input.sellingPrice, input.downPayment);
  const financeCost = dAdd(truePrincipal, d(input.storeCommission));
  const prepaidApplied = dAdd(rescheduleAdvanceApplied, advanceBalanceApplied);
  const parkMonths =
    prepaidApplied.gt(0) && monthlyPayment.gt(0) ? dDiv(prepaidApplied, monthlyPayment) : d(0);
  const netRemainingMonths = Prisma.Decimal.max(0, dSub(input.remainingMonths, parkMonths));
  const remainingCost = round2(dMul(dDiv(financeCost, input.totalMonths), netRemainingMonths));

  // (7) ส่วนลด (default 50%, max 50% ตามนโยบาย)
  const discountPercent =
    input.discountPctInput != null ? Math.max(0, Math.min(50, input.discountPctInput)) : 50;
  const vatPct = d(input.vatPct);

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

  // (8) ยอดชำระปิดยอด — ค่าปรับบวกทั้งก้อน (ไม่คิด VAT ไม่ลด ตามนโยบาย)
  const unpaidLateFees = dSum(
    input.payments.filter((p) => p.status !== 'PAID' && !p.lateFeeWaived).map((p) => d(p.lateFee)),
  ).toNumber();
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
    rescheduleAdvanceApplied,
    advanceBalanceApplied,
  };
}
