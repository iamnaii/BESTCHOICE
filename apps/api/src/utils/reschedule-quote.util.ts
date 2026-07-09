import { Prisma } from '@prisma/client';
import { LateFeeConfig, resolveLivePaymentLateFee } from './late-fee.util';

export type RescheduleSplitMode = 'SINGLE' | 'SPLIT';

export interface RescheduleQuoteInput {
  /** Contract.monthlyPayment — per-installment total incl. commission + VAT. */
  monthlyPayment: Prisma.Decimal | number | string;
  daysToShift: number;
  /**
   * SINGLE = 6b (จ่ายทั้งก้อนวันนี้: ค่างวด + ยอดปรับดิว + ค่าปรับ ครั้งเดียว)
   * SPLIT  = 6a (แบ่ง 2 ครั้ง: วันนี้เก็บยอดปรับดิว + ค่าปรับ, ค่างวดชำระตามดิวใหม่)
   */
  splitMode: RescheduleSplitMode;
  /** The Payment row being rescheduled (late fee owed for the CURRENT overdue period). */
  payment: {
    dueDate: Date;
    amountDue: Prisma.Decimal | number | string;
    /** Optional for legacy callers — missing → 0 (nothing paid yet). */
    amountPaid?: Prisma.Decimal | number | string;
    lateFeeWaived: boolean;
  };
  lateFeeCfg: LateFeeConfig;
  now: Date;
}

export interface RescheduleQuote {
  /** monthlyPayment / 30 × daysToShift, ROUND_UP whole baht (owner policy 2026-06). */
  rescheduleFee: Prisma.Decimal;
  /** Late fee owed for days ALREADY overdue vs the CURRENT (pre-shift) due date. */
  lateFee: Prisma.Decimal;
  /** ยอดค่างวดคงเหลือของงวดนี้ (amountDue − amountPaid) — the 6b bundled portion. */
  installmentOutstanding: Prisma.Decimal;
  /**
   * Cash to collect at confirm:
   *   6b → installmentOutstanding + fee + lateFee (CPA case-6b: จ่ายทั้งก้อนวันนี้)
   *   6a → fee + lateFee (ค่างวดตามดิวใหม่)
   */
  collectAmount: Prisma.Decimal;
  variant: '6a' | '6b';
}

/**
 * Single source of truth for the ปรับดิว (reschedule) money quote — used by the
 * quote endpoint, the atomic collect+reschedule execution, AND the reschedule-QR
 * intent so all three always agree (owner directive 2026-07-02: เงินไม่เข้า ดิวไม่เลื่อน,
 * ค่าปรับของช่วงที่เกินมาแล้วต้องถูกเก็บตอนปรับดิว ไม่ใช่ระเหยไปกับ due date ใหม่).
 *
 * Variant semantics (owner correction 2026-07-09, CPA ตารางผ่อนชำระ ก่อน/หลังปรับดิว):
 *   6b — customer pays THIS installment + reschedule fee (+ late fee) in ONE
 *        payment TODAY; only the REMAINING installments shift. The fee is an
 *        advance (Cr 21-1103) that relieves a future installment.
 *   6a — customer pays the fee (+ late fee) today; THIS installment shifts to
 *        the new due date and is paid then.
 *
 * Fee formula mirrors RescheduleService.execute exactly (anti-drift assert at the
 * execution site). Late fee mirrors the wizard display / recordPayment recompute
 * via resolveLivePaymentLateFee (mode-aware PER_DAY/BRACKET, waived → 0).
 */
/** ยอดปรับดิว = monthlyPayment / 30 × daysToShift, ROUND_UP whole baht (owner policy 2026-06). */
export function computeRescheduleFee(
  monthlyPayment: Prisma.Decimal | number | string,
  daysToShift: number,
): Prisma.Decimal {
  return new Prisma.Decimal(monthlyPayment.toString())
    .div(30)
    .times(daysToShift)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_UP);
}

export function computeRescheduleQuote(input: RescheduleQuoteInput): RescheduleQuote {
  const fee = computeRescheduleFee(input.monthlyPayment, input.daysToShift);

  const lateFee = resolveLivePaymentLateFee(input.payment, input.lateFeeCfg, input.now);

  const installmentOutstanding = Prisma.Decimal.max(
    0,
    new Prisma.Decimal(input.payment.amountDue.toString()).minus(
      (input.payment.amountPaid ?? 0).toString(),
    ),
  );

  const variant = input.splitMode === 'SPLIT' ? '6a' : '6b';
  const collectAmount =
    variant === '6a'
      ? fee.plus(lateFee)
      : installmentOutstanding.plus(fee).plus(lateFee);

  return { rescheduleFee: fee, lateFee, installmentOutstanding, collectAmount, variant };
}
