import { Decimal } from '@prisma/client/runtime/library';
import {
  Accrual2ABasis,
  AccruedSoFar,
  NOTHING_ACCRUED,
  partialAccrualPortion,
  remainingAccrualPortion,
} from './build-accrual-2a-lines';
import type { SplitReceiptResult } from './split-receipt';
import { advanceVatOf } from './advance-vat';

/**
 * ใบกำกับภาษีตามบัญชี (PR3 — คำตัดสินฝ่ายบัญชี D3–D5, 2026-09-28): ตัวเลขทุกสตางค์ที่พิมพ์บนใบเสร็จรับเงิน /
 * ใบกำกับภาษี คำนวณที่ไฟล์นี้ที่เดียว แล้วเก็บ ณ ตอนออกใบ (PDF และใบลดหนี้อ่านค่าที่เก็บ ไม่คำนวณใหม่).
 *
 * แถวของเอกสารใบรับชำระค่างวด:
 *   ค่างวด            = ยอดที่ใบนี้ล้างลูกหนี้ของงวด (Cr 11-2103 — รวมส่วนลดเศษสตางค์ 52-1104 และเงินรับล่วงหน้าที่หัก
 *                       เข้างวดในใบเดียวกัน) · ภาษี = กติกาเดียวกับรายการตั้งลูกหนี้งวด (ก1): HALF_UP(ยอด × 7/107)
 *                       ใบที่ทำให้ยอดสะสมของงวดครบรับส่วนที่เหลือ (ภาษีของงวด − ภาษีที่เอกสารก่อนหน้าของงวดแสดงแล้ว)
 *   เงินรับล่วงหน้า    = + ส่วนที่พักเป็นเงินรับล่วงหน้า (Cr 21-1103) / − ส่วนที่หักเงินรับล่วงหน้าเข้างวด (Dr 21-1103)
 *                       ภาษี = HALF_UP(|ยอด| × 7/107) เครื่องหมายเดียวกับยอด (ปกติเงินที่หักคือเงินที่ออกเอกสารพร้อมภาษีไปแล้ว
 *                       ตอนรับ — ไม่แสดงภาษีซ้ำ · เงินบางแหล่งไม่เคยมีเอกสารภาษี — ดู accounting.md หัวข้อ
 *                       "ใบกำกับภาษีตามบัญชี" · ที่ยังเปิดอยู่)
 *   ค่าปรับ            = Cr 42-1103 − Dr 52-1105 (นอกฐานภาษี) · อนุโลม = Dr 52-1105
 *   ปัดเศษ             = Cr 53-1503 − Dr 52-1104 (นอกฐานภาษี)
 * ต้องเป็นจริงเสมอ: amountBeforeVat + vatAmount + roundingAmount + lateFeeAmount = amount
 */
export const RECEIPT_TAX_VERSION = 1 as const;

/** ค่าที่เก็บบนแถว Receipt (สตริง 2 ตำแหน่ง — ประทับลง metadata ของรายการรับชำระด้วย) */
export interface ReceiptTaxBreakdown {
  version: typeof RECEIPT_TAX_VERSION;
  /** เงินที่รับตามใบนี้ (= Receipt.amount) */
  amount: string;
  /** มูลค่าก่อนภาษีของทั้งเอกสาร (แถวค่างวด + แถวเงินรับล่วงหน้า) */
  amountBeforeVat: string;
  /** ภาษีมูลค่าเพิ่มของทั้งเอกสาร */
  vatAmount: string;
  /** ปัดเศษนอกฐานภาษี: + เก็บเกิน / − ส่วนลดเศษสตางค์ */
  roundingAmount: string;
  /** ค่าปรับสุทธิที่รับในใบนี้ */
  lateFeeAmount: string;
  /** ค่าปรับส่วนที่อนุโลมในใบนี้ */
  lateFeeWaivedAmount: string;
  /** + พักเป็นเงินรับล่วงหน้า / − หักเงินรับล่วงหน้าเข้างวด */
  advanceAmount: string;
  /** ภาษีของแถวเงินรับล่วงหน้า (เครื่องหมายเดียวกับ advanceAmount) */
  advanceVatAmount: string;
  /**
   * ส่วนลดดอกเบี้ยปิดยอด (Dr 52-1106) — แถวแยกไม่ลดฐานภาษี (ฝ่ายบัญชี 16/10/2569 ข้อ 16.1 · ใบปิดยอดก่อนกำหนด
   * ตั้งแต่ 2026-10-18) · ไม่มี = 0 (ใบค่างวด / stamp เดิมทุกใบ) ⇒ invariant: amountBeforeVat + vatAmount + roundingAmount
   * + lateFeeAmount − discountAmount = amount
   */
  discountAmount?: string;
}

const ZERO = new Decimal(0);
const money = (d: Decimal) => d.toFixed(2);

/** สูตรเดียวอยู่ที่ advance-vat.ts (PR4) — re-export ให้ผู้เรียกเดิม ห้ามมีสูตรที่สอง */
export { advanceVatOf };

/**
 * ภาษีที่เอกสารแสดงไปแล้วของงวด ณ ก่อนใบนี้ — เล่นซ้ำกติกาเดียวกับรายการตั้งลูกหนี้งวด (partialAccrualPortion)
 * ทีละรายการตามลำดับที่ลง. `priorClearings` = Cr 11-2103 ของรายการรับชำระและรายการหักเงินรับล่วงหน้าเข้างวด
 * (รอบกลางคืน) ที่ยังมีผล — ชุดเดียวกับที่ reconstructPriorCleared นับ.
 */
export function documentedSoFar(
  basis: Accrual2ABasis,
  priorClearings: readonly Decimal[],
): AccruedSoFar {
  let doc: AccruedSoFar = NOTHING_ACCRUED;
  for (const cleared of priorClearings) {
    const p = partialAccrualPortion(basis, doc, cleared);
    doc = {
      amount: doc.amount.plus(p.total),
      vat: doc.vat.plus(p.vat),
      interest: doc.interest.plus(p.interest),
    };
  }
  return doc;
}

export interface InstallmentReceiptTaxInput {
  /** ฐานของงวด — computeInstallmentBreakdown ที่ส่ง installmentNo แล้ว (งวดสุดท้ายรับเศษ) */
  basis: Accrual2ABasis;
  /** Cr 11-2103 ของรายการก่อนหน้าของงวดที่ยังมีผล ตามลำดับที่ลง (reconstructPriorCleared.priorClearings) */
  priorClearings: readonly Decimal[];
  /** เงินที่รับตามใบนี้ (Dr เงินสด/ธนาคาร หรือ Dr 21-5101 เมื่อใช้เครดิต) */
  delta: Decimal;
  split: Pick<
    SplitReceiptResult,
    'principalCleared' | 'lateFeePortion' | 'overpayRounding' | 'underpayRounding'
  >;
  lateFeeWaived: Decimal;
  advanceConsume: Decimal;
  advanceCredit: Decimal;
  /**
   * PR4 (ต9): ภาษีของขากลับที่รายการบัญชีลงจริงสำหรับเงินรับล่วงหน้าที่หักเข้างวดในใบนี้ (resolveConsumeVat —
   * เพดาน "ยังค้าง" · ใบสุดท้ายรับเศษ) → แถว "หักเงินรับล่วงหน้า" พิมพ์ภาษีตัวเดียวกับบัญชี (ปิดช่อง ±0.01 ของ 250 + 250).
   * ไม่ส่ง = สูตรเดิม HALF_UP(ยอดที่หัก × 7/107).
   */
  advanceVatConsumed?: Decimal;
}

export interface InstallmentReceiptTax {
  breakdown: ReceiptTaxBreakdown;
  /** ภาษีของแถวค่างวด — ต้องเท่ากับ Cr 21-2101 ของรายการตั้งลูกหนี้งวด (2A) ที่ใบนี้ลง (ถ้ามี) */
  installmentVat: Decimal;
}

/** ใบรับชำระค่างวด (PaymentReceiptTemplate) — ทุกค่ามาจากผลของ splitReceipt ตัวเดียวกับรายการบัญชี */
export function computeInstallmentReceiptTax(
  input: InstallmentReceiptTaxInput,
): InstallmentReceiptTax {
  const cleared = input.split.principalCleared;
  const docBefore = documentedSoFar(input.basis, input.priorClearings);
  const rest = remainingAccrualPortion(input.basis, docBefore);
  const installmentVat =
    cleared.gt(0) && rest.total.gt(0)
      ? partialAccrualPortion(input.basis, docBefore, cleared).vat
      : ZERO;
  const advanceAmount = input.advanceCredit.minus(input.advanceConsume);
  // พัก = ภาษีตามสูตร (เท่าขาพักของบัญชี) · หัก = ขากลับที่บัญชีลงจริงเมื่อผู้เรียกส่งมา ไม่งั้นสูตรเดิม
  const consumedVat =
    input.advanceVatConsumed !== undefined && input.advanceConsume.gt(0)
      ? input.advanceVatConsumed
      : advanceVatOf(input.advanceConsume);
  const advanceVat = advanceVatOf(input.advanceCredit).minus(consumedVat);
  const vatAmount = installmentVat.plus(advanceVat);
  const amountBeforeVat = cleared.minus(installmentVat).plus(advanceAmount.minus(advanceVat));
  return {
    installmentVat,
    breakdown: {
      version: RECEIPT_TAX_VERSION,
      amount: money(input.delta),
      amountBeforeVat: money(amountBeforeVat),
      vatAmount: money(vatAmount),
      roundingAmount: money(input.split.overpayRounding.minus(input.split.underpayRounding)),
      lateFeeAmount: money(input.split.lateFeePortion),
      lateFeeWaivedAmount: money(input.lateFeeWaived),
      advanceAmount: money(advanceAmount),
      advanceVatAmount: money(advanceVat),
    },
  };
}

/** เงิน 2 ตำแหน่งเป็นสตริง (ติดลบได้ — แถวหักเงินรับล่วงหน้า) */
const MONEY_RE = /^-?\d{1,10}\.\d{2}$/;

const MONEY_FIELDS = [
  'amount',
  'amountBeforeVat',
  'vatAmount',
  'roundingAmount',
  'lateFeeAmount',
  'lateFeeWaivedAmount',
  'advanceAmount',
  'advanceVatAmount',
] as const;

/**
 * อ่านค่าที่ประทับใน metadata ของรายการรับชำระ — รูปไม่ครบ / ไม่ใช่เงิน 2 ตำแหน่ง / ผลรวมไม่เท่ายอดรับ = null
 * (ผู้อ่านถือว่าไม่มีค่า แล้วใช้ตรรกะเดิม)
 */
export function parseReceiptTax(value: unknown): ReceiptTaxBreakdown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== RECEIPT_TAX_VERSION) return null;
  for (const field of MONEY_FIELDS) {
    const raw = v[field];
    if (typeof raw !== 'string' || !MONEY_RE.test(raw)) return null;
  }
  // ส่วนลดดอกเบี้ยปิดยอด (optional — ใบปิดยอดตั้งแต่ 2026-10-18) · มีแต่รูปผิด = stamp ใช้ไม่ได้
  const hasDiscount = v.discountAmount !== undefined;
  if (hasDiscount && (typeof v.discountAmount !== 'string' || !MONEY_RE.test(v.discountAmount))) return null;
  const d = (field: (typeof MONEY_FIELDS)[number]) => new Decimal(v[field] as string);
  const discount = hasDiscount ? new Decimal(v.discountAmount as string) : ZERO;
  if (
    !d('amountBeforeVat')
      .plus(d('vatAmount'))
      .plus(d('roundingAmount'))
      .plus(d('lateFeeAmount'))
      .minus(discount)
      .eq(d('amount'))
  ) {
    return null;
  }
  const out = { version: RECEIPT_TAX_VERSION } as ReceiptTaxBreakdown;
  for (const field of MONEY_FIELDS) out[field] = v[field] as string;
  if (hasDiscount) out.discountAmount = v.discountAmount as string;
  return out;
}

/** ค่าที่เขียนลงคอลัมน์ของแถว Receipt */
export function receiptTaxColumns(b: ReceiptTaxBreakdown) {
  return {
    amountBeforeVat: new Decimal(b.amountBeforeVat),
    vatAmount: new Decimal(b.vatAmount),
    roundingAmount: new Decimal(b.roundingAmount),
    lateFeeAmount: new Decimal(b.lateFeeAmount),
    lateFeeWaivedAmount: new Decimal(b.lateFeeWaivedAmount),
    advanceAmount: new Decimal(b.advanceAmount),
    advanceVatAmount: new Decimal(b.advanceVatAmount),
    // ใบปิดยอด (16.1): ส่วนลดดอกเบี้ย 52-1106 · ใบอื่น/stamp เดิม = 0 (คอลัมน์ไม่ null เมื่อใบเก็บค่า)
    discountAmount: new Decimal(b.discountAmount ?? '0'),
  };
}

/** อ่านค่าเงินจาก metadata (สตริง/ตัวเลข) — ไม่ใช่เงิน = null */
function moneyOf(value: unknown): Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * ใบปรับดิว 6a (PR4ข — ฝ่ายบัญชี 16/10/2569 ข้อ 14 / 23.1): ค่าธรรมเนียมที่พักเป็นเงินรับล่วงหน้างวดสุดท้าย (Cr 21-1103)
 * ออกใบกำกับภาษีตอนรับ — ภาษี = stamp `advanceVatPark` ของรายการ `reschedule-collect` (ตัวเดียวกับ Cr 21-2101 ที่ลงจริง)
 * ค่าปรับ (42-1103) อยู่นอกฐานภาษี. คืน null (ใบพิมพ์ตรรกะเดิม ไม่ใช่ใบกำกับภาษี) เมื่อไม่ใช่ 6a · ไม่มี stamp ภาษี (รายการก่อน
 * PR4) · ยอดใบไม่เท่าค่าธรรมเนียม + ค่าปรับ.
 *   เงินรับล่วงหน้า = rescheduleFee · ภาษี = advanceVatPark · ก่อนภาษี = rescheduleFee − ภาษี · ค่าปรับ = lateFeeCollected
 */
export function rescheduleFeeReceiptTax(
  meta: Record<string, unknown>,
  amount: Decimal,
): ReceiptTaxBreakdown | null {
  if (meta.variant !== '6a') return null;
  const fee = moneyOf(meta.rescheduleFee);
  const vat = moneyOf(meta.advanceVatPark);
  const lateFee = moneyOf(meta.lateFeeCollected ?? 0);
  if (!fee || !vat || !lateFee || !fee.gt(0) || vat.lt(0) || lateFee.lt(0)) return null;
  if (!fee.plus(lateFee).eq(amount)) return null;
  return {
    version: RECEIPT_TAX_VERSION,
    amount: money(amount),
    amountBeforeVat: money(fee.minus(vat)),
    vatAmount: money(vat),
    roundingAmount: money(ZERO),
    lateFeeAmount: money(lateFee),
    lateFeeWaivedAmount: money(ZERO),
    advanceAmount: money(fee),
    advanceVatAmount: money(vat),
  };
}

/**
 * ใบรับเงินส่วนเกินจากลิงก์ชำระ (PR4ข — ฝ่ายบัญชี 23.2 แยกใบ): เงินที่เกินงวดถูกพักเป็นเงินรับล่วงหน้า (Cr 21-1103) พร้อม
 * ภาษี stamp `advanceVatPark` ของรายการ `paysolutions-surplus-advance`. ไม่มี stamp = ภาษีตามสูตรต้องเป็นศูนย์ (ส่วนเกินเล็กจน
 * HALF_UP ปัดเป็น 0) ไม่งั้น null. ยอดใบต้องเท่า surplus.
 */
export function advanceSurplusReceiptTax(
  meta: Record<string, unknown>,
  amount: Decimal,
): ReceiptTaxBreakdown | null {
  const surplus = moneyOf(meta.surplus);
  if (!surplus || !surplus.gt(0) || !surplus.eq(amount)) return null;
  const vat = meta.advanceVatPark === undefined ? advanceVatOf(surplus) : moneyOf(meta.advanceVatPark);
  if (!vat || vat.lt(0) || (meta.advanceVatPark === undefined && !vat.isZero())) return null;
  return {
    version: RECEIPT_TAX_VERSION,
    amount: money(amount),
    amountBeforeVat: money(surplus.minus(vat)),
    vatAmount: money(vat),
    roundingAmount: money(ZERO),
    lateFeeAmount: money(ZERO),
    lateFeeWaivedAmount: money(ZERO),
    advanceAmount: money(surplus),
    advanceVatAmount: money(vat),
  };
}


/** ตัวเลขของรายการ JP4 ที่ใบปิดยอดก่อนกำหนดต้องพิมพ์ — ทุกค่าจาก `buildEarlyPayoffJE` ยกเว้น `installmentVat` */
export interface EarlyPayoffReceiptTaxInput {
  /** เงินที่รับ (= quote.totalPayoff = Receipt.amount) */
  amount: Decimal;
  /** ลูกหนี้ตามบัญชีที่ล้าง (11-2101 + 11-2103 + 11-2105 รวมภาษี) */
  receivableCleared: Decimal;
  /** Σ ภาษีคงเหลือของทุกงวดที่ใบนี้ปิด — กติกา PR3 ต่องวด (`remainingInstallmentVat`) */
  installmentVat: Decimal;
  /** Cr 42-1103 (netted) — นอกฐานภาษี */
  lateFees: Decimal;
  /** Dr 52-1106 — แถว "ส่วนลดดอกเบี้ยปิดยอด" ไม่ลดฐานภาษี */
  discount: Decimal;
  /** เงินของลูกค้าที่ยอดปิดหัก: เงินพักค่าปรับดิว · เงินรับล่วงหน้าถังรวม · เครดิต 21-5101 (แถวติดลบแถวเดียว) */
  parkRelief: Decimal;
  advanceRelief: Decimal;
  creditRelief: Decimal;
  /**
   * Dr 21-2101 / Cr 21-2102 — ภาษีที่ออกใบกำกับไปแล้วของเงินที่หัก (ข้อ 13–14) · JP4 คิดจากเงินที่หักทั้งหมด (เงินพัก + ถังรวม + เครดิต)
   * cap ด้วยภาษีพักที่ค้าง ⇒ เครดิตที่เคยพักภาษี (จ่ายเกิน/ส่วนเกินลิงก์) มีภาษีในแถวหัก · เครดิตที่ไม่เคยพัก (เปลี่ยนเครื่องตำหนิ / ก่อน PR4) ไม่มี
   */
  advanceVatReversal: Decimal;
  /** Cr 53-1503 — ปัดเศษเก็บเกิน (นอกฐานภาษี) */
  roundingGain: Decimal;
  /** 18.2 — เงินรับเกินยอดปิดที่ลงรายได้ · > 0 = ใบนี้ยังไม่รองรับ (คืน null → พิมพ์แบบเดิม) */
  excessIncome: Decimal;
}

/**
 * ใบปิดยอดก่อนกำหนดเป็นใบกำกับภาษีตามบัญชี (ฝ่ายบัญชี 16/10/2569 ข้อ 16.1/16.2 · mockup เจ้าของเคาะ 18/10/2569):
 *   แถวค่างวดคงเหลือ   = ลูกหนี้ตามบัญชีที่ล้าง · ภาษี = Σ ภาษีคงเหลือของแต่ละงวด (ใบที่ทำให้ครบรับส่วนที่เหลือ — PR3)
 *   แถวหักเงินของลูกค้า = −(เงินพัก + ถังรวม + เครดิต) · ภาษี = −ขากลับที่ JP4 ลงจริง (ภาษีที่ออกใบกำกับไปแล้วตอนรับ)
 *   แถวส่วนลดดอกเบี้ย   = 52-1106 (ไม่ลดฐานภาษี) · ค่าปรับ / ปัดเศษ นอกฐานภาษีเหมือนใบค่างวด
 * null = ใบพิมพ์แบบเดิม (ไม่ใช่ใบกำกับภาษีตามบัญชี): มีเงินรับเกิน (18.2) · ค่าติดลบ · ตัวเลขไม่ลงตัวกับเงินที่รับ
 */
export function earlyPayoffReceiptTax(input: EarlyPayoffReceiptTaxInput): ReceiptTaxBreakdown | null {
  const {
    amount,
    receivableCleared,
    installmentVat,
    lateFees,
    discount,
    parkRelief,
    advanceRelief,
    creditRelief,
    advanceVatReversal,
    roundingGain,
    excessIncome,
  } = input;
  if (excessIncome.gt(0)) return null;
  const nonNegative = [
    amount,
    receivableCleared,
    installmentVat,
    lateFees,
    discount,
    parkRelief,
    advanceRelief,
    creditRelief,
    advanceVatReversal,
    roundingGain,
  ];
  if (nonNegative.some((v) => !v.isFinite() || v.isNegative())) return null;
  const advanceAmount = parkRelief.plus(advanceRelief).plus(creditRelief).negated();
  const advanceVatAmount = advanceVatReversal.negated();
  const amountBeforeVat = receivableCleared
    .minus(installmentVat)
    .plus(advanceAmount.minus(advanceVatAmount));
  const vatAmount = installmentVat.plus(advanceVatAmount);
  // ผู้ตรวจอิสระ I1: ฐาน/ภาษีติดลบ (เช่น เงินพักหักงวดสุดท้ายพอดี ภาษีขากลับ 99.17 > ภาษีงวด 99.13 · ลูกหนี้ตามบัญชีเล็กกว่าเงินที่หัก)
  // = ใบกำกับภาษีที่อ่านไม่ได้ → ไม่เก็บค่า (พิมพ์แบบเดิม + สัญญาณเตือน)
  if (amountBeforeVat.isNegative() || vatAmount.isNegative()) return null;
  const identity = amountBeforeVat.plus(vatAmount).plus(roundingGain).plus(lateFees).minus(discount);
  if (!identity.eq(amount)) return null;
  return {
    version: RECEIPT_TAX_VERSION,
    amount: money(amount),
    amountBeforeVat: money(amountBeforeVat),
    vatAmount: money(vatAmount),
    roundingAmount: money(roundingGain),
    lateFeeAmount: money(lateFees),
    lateFeeWaivedAmount: money(ZERO),
    advanceAmount: money(advanceAmount),
    advanceVatAmount: money(advanceVatAmount),
    discountAmount: money(discount),
  };
}
