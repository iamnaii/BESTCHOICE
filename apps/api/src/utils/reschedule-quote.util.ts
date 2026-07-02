import { Prisma } from '@prisma/client';
import { LateFeeConfig, resolveLivePaymentLateFee } from './late-fee.util';

export type RescheduleSplitMode = 'SINGLE' | 'SPLIT';

export interface RescheduleQuoteInput {
  /** Contract.monthlyPayment — per-installment total incl. commission + VAT. */
  monthlyPayment: Prisma.Decimal | number | string;
  daysToShift: number;
  /** SINGLE = 6b (fee rides next installment) | SPLIT = 6a (fee collected now). */
  splitMode: RescheduleSplitMode;
  /** The Payment row being rescheduled (late fee owed for the CURRENT overdue period). */
  payment: {
    dueDate: Date;
    amountDue: Prisma.Decimal | number | string;
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
  /** Cash to collect at confirm: 6a → fee + lateFee; 6b → lateFee only. */
  collectAmount: Prisma.Decimal;
  variant: '6a' | '6b';
}

/**
 * Single source of truth for the ปรับดิว (reschedule) money quote — used by the
 * quote endpoint, the atomic collect+reschedule execution, AND the reschedule-QR
 * intent so all three always agree (owner directive 2026-07-02: เงินไม่เข้า ดิวไม่เลื่อน,
 * ค่าปรับของช่วงที่เกินมาแล้วต้องถูกเก็บตอนปรับดิว ไม่ใช่ระเหยไปกับ due date ใหม่).
 *
 * Fee formula mirrors RescheduleService.execute exactly (anti-drift assert at the
 * execution site). Late fee mirrors the wizard display / recordPayment recompute
 * via resolveLivePaymentLateFee (mode-aware PER_DAY/BRACKET, waived → 0).
 */
export function computeRescheduleQuote(input: RescheduleQuoteInput): RescheduleQuote {
  const fee = new Prisma.Decimal(input.monthlyPayment.toString())
    .div(30)
    .times(input.daysToShift)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_UP);

  const lateFee = resolveLivePaymentLateFee(input.payment, input.lateFeeCfg, input.now);

  const variant = input.splitMode === 'SPLIT' ? '6a' : '6b';
  const collectAmount = variant === '6a' ? fee.plus(lateFee) : lateFee;

  return { rescheduleFee: fee, lateFee, collectAmount, variant };
}
