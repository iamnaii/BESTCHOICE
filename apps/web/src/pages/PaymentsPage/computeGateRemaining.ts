import Decimal from 'decimal.js';
import { computeNetReceiptDue } from './computeNetReceiptDue';

/** Minimal shape of a PendingPayment row needed to net the gate's "remaining". */
export interface GateRemainingPayment {
  installmentNo: number;
  amountDue: Decimal.Value;
  lateFee: Decimal.Value;
  amountPaid: Decimal.Value;
  contract: {
    totalMonths: number;
    /** ถังรวม (FIFO) — generic advance parked in 21-1103. */
    advanceBalance?: Decimal.Value | null;
    /** ถังพักงวดสุดท้าย — reschedule fee (6a/6b), consumable only on the last installment. */
    rescheduleAdvanceBalance?: Decimal.Value | null;
  };
}

/** Minimal shape of the wizard's submit payload needed by the gate. */
export interface GateRemainingPayload {
  consumeAdvance: boolean;
  lateFeeWaiverAmount?: number;
}

/**
 * The figure `paymentToleranceGate` must compare the cashier's amount against.
 *
 * It MUST be the same number the wizard prefilled into the amount field,
 * otherwise the ±1฿ gate reads the netted credit as an under-payment and blocks
 * the submit. That is exactly what happened to the last-installment park bucket
 * (พักงวดสุดท้าย): the wizard deducted it via `computeNetReceiptDue` while the page
 * netted only `advanceBalance`, so any real reschedule fee (> 1฿) hard-blocked the
 * payment.
 *
 * So this delegates to `computeNetReceiptDue` — the wizard's own single source of
 * truth — instead of re-deriving the netting. Keeping ONE implementation is the
 * fix; a second, "equivalent" copy is what created the bug.
 */
export function computeGateRemaining(
  payment: GateRemainingPayment,
  payload: GateRemainingPayload,
): number {
  return computeNetReceiptDue({
    amountDue: payment.amountDue,
    lateFee: payment.lateFee,
    amountPaid: payment.amountPaid,
    waiver: payload.lateFeeWaiverAmount ?? 0,
    advanceBalance: payment.contract.advanceBalance ?? 0,
    consumeAdvance: payload.consumeAdvance,
    rescheduleAdvanceBalance: payment.contract.rescheduleAdvanceBalance ?? 0,
    // Same predicate as RecordPaymentWizard: park is customer money earmarked for
    // the FINAL installment only — never netted on any earlier installment.
    isLastInstallment: payment.installmentNo === payment.contract.totalMonths,
  }).toNumber();
}
