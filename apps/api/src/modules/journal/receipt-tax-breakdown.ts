import { Decimal } from '@prisma/client/runtime/library';
import {
  Accrual2ABasis,
  AccruedSoFar,
  NOTHING_ACCRUED,
  partialAccrualPortion,
  remainingAccrualPortion,
} from './build-accrual-2a-lines';
import type { SplitReceiptResult } from './split-receipt';

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
}

const ZERO = new Decimal(0);
const money = (d: Decimal) => d.toFixed(2);

/** ภาษีของเงินที่รับไว้ล่วงหน้า / ที่หักเข้างวด = HALF_UP(|ยอด| × 7/107) เครื่องหมายเดียวกับยอด */
export function advanceVatOf(amount: Decimal): Decimal {
  const share = amount.abs().times(7).div(107).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return amount.isNegative() ? share.negated() : share;
}

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
  const advanceVat = advanceVatOf(advanceAmount);
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
    if (typeof raw !== 'string' || !/^-?\d{1,10}\.\d{2}$/.test(raw)) return null;
  }
  const d = (field: (typeof MONEY_FIELDS)[number]) => new Decimal(v[field] as string);
  if (
    !d('amountBeforeVat')
      .plus(d('vatAmount'))
      .plus(d('roundingAmount'))
      .plus(d('lateFeeAmount'))
      .eq(d('amount'))
  ) {
    return null;
  }
  const out = { version: RECEIPT_TAX_VERSION } as ReceiptTaxBreakdown;
  for (const field of MONEY_FIELDS) out[field] = v[field] as string;
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
  };
}
