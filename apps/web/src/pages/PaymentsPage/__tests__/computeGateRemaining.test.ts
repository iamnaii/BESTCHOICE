import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeGateRemaining, type GateRemainingPayment } from '../computeGateRemaining';
import { computeNetReceiptDue } from '../computeNetReceiptDue';
import { paymentToleranceGate } from '../paymentToleranceGate';

/**
 * C-2 regression suite.
 *
 * PaymentsPage's onSubmit ran the ±1฿ tolerance gate against a `remaining` that
 * netted ONLY `contract.advanceBalance`, while RecordPaymentWizard prefilled the
 * amount from `computeNetReceiptDue` WITH the last-installment park bucket
 * (พักงวดสุดท้าย) deducted. absDiff then equalled the park amount — any real
 * reschedule fee is > 1฿ → 'block' → the mutation never fired, making the
 * feature's primary payment path unreachable through the only UI hosting the
 * wizard.
 *
 * These tests pin the gate input to the wizard's own prefill formula.
 */

const INSTALLMENT_TOTAL = '1515.83';

function makePayment(overrides: {
  installmentNo?: number;
  totalMonths?: number;
  amountDue?: string;
  lateFee?: string;
  amountPaid?: string;
  advanceBalance?: string;
  rescheduleAdvanceBalance?: string;
}): GateRemainingPayment {
  return {
    installmentNo: overrides.installmentNo ?? 12,
    amountDue: overrides.amountDue ?? INSTALLMENT_TOTAL,
    lateFee: overrides.lateFee ?? '0',
    amountPaid: overrides.amountPaid ?? '0',
    contract: {
      totalMonths: overrides.totalMonths ?? 12,
      advanceBalance: overrides.advanceBalance ?? '0',
      rescheduleAdvanceBalance: overrides.rescheduleAdvanceBalance ?? '0',
    },
  };
}

/** Exactly what RecordPaymentWizard prefills into the amount field. */
function wizardPrefill(payment: GateRemainingPayment, consumeAdvance = true): number {
  return computeNetReceiptDue({
    amountDue: payment.amountDue,
    lateFee: payment.lateFee,
    amountPaid: payment.amountPaid,
    advanceBalance: payment.contract.advanceBalance ?? 0,
    consumeAdvance,
    rescheduleAdvanceBalance: payment.contract.rescheduleAdvanceBalance ?? 0,
    isLastInstallment: payment.installmentNo === payment.contract.totalMonths,
  }).toNumber();
}

describe('computeGateRemaining — park bucket (พักงวดสุดท้าย)', () => {
  it('C-2: last installment with a park bucket is NOT blocked (park is netted)', () => {
    const payment = makePayment({
      installmentNo: 12,
      totalMonths: 12,
      rescheduleAdvanceBalance: '857.00',
    });

    const remaining = computeGateRemaining(payment, { consumeAdvance: true });
    expect(remaining).toBe(658.83); // 1515.83 − 857.00

    // The cashier submits exactly what the wizard prefilled.
    const gate = paymentToleranceGate('NORMAL', wizardPrefill(payment), remaining);
    expect(gate).toEqual({ action: 'proceed', absDiff: 0 });
  });

  /**
   * Important-1 (re-review 2026-08-18): this case used to be titled "zero-cash
   * submit proceeds", which was FALSE end-to-end — the server rejects a zero
   * amount on two independent guards (`RecordPaymentDto.amount @Min(0.01)` and the
   * orchestrator's own `amount <= 0` check), so nothing would ever have been
   * recorded. What this test legitimately pins is the ARITHMETIC: the park bucket
   * fully absorbs the last installment, so the tolerance gate sees nothing left to
   * collect and does not raise a false "ส่วนต่างเกิน 1 ฿" block. The wizard now
   * refuses the zero-cash submit itself (`canSubmit`) and explains that the credit
   * is applied automatically at accrual — see RecordPaymentWizard's CaseBadge.
   */
  it('C-2: park large enough to cover the whole installment → gate computes 0 owed (submit itself is blocked client-side)', () => {
    const payment = makePayment({
      installmentNo: 12,
      totalMonths: 12,
      rescheduleAdvanceBalance: '2000.00',
    });

    const remaining = computeGateRemaining(payment, { consumeAdvance: true });
    expect(remaining).toBe(0);
    // The gate must not manufacture a >1฿ difference out of the fully-netted park.
    expect(paymentToleranceGate('NORMAL', wizardPrefill(payment), remaining).action).toBe(
      'proceed',
    );
  });

  it('non-last installment: park is NOT netted (gate sees the full installment)', () => {
    const payment = makePayment({
      installmentNo: 6,
      totalMonths: 12,
      rescheduleAdvanceBalance: '857.00',
    });

    const remaining = computeGateRemaining(payment, { consumeAdvance: true });
    expect(remaining).toBe(1515.83); // park untouched — FIFO is forbidden for this bucket
    expect(paymentToleranceGate('NORMAL', wizardPrefill(payment), remaining).action).toBe(
      'proceed',
    );
  });

  it('last installment, generic advance consumes FIRST then park', () => {
    const payment = makePayment({
      installmentNo: 12,
      totalMonths: 12,
      lateFee: '100',
      advanceBalance: '500.00',
      rescheduleAdvanceBalance: '857.00',
    });

    // owed 1615.83 − generic 500 = 1115.83 − park 857 = 258.83
    const remaining = computeGateRemaining(payment, { consumeAdvance: true });
    expect(remaining).toBe(258.83);
    expect(paymentToleranceGate('NORMAL', wizardPrefill(payment), remaining).action).toBe(
      'proceed',
    );
  });

  it('credit checkbox OFF: neither bucket is netted, even on the last installment', () => {
    const payment = makePayment({
      installmentNo: 12,
      totalMonths: 12,
      advanceBalance: '500.00',
      rescheduleAdvanceBalance: '857.00',
    });

    const remaining = computeGateRemaining(payment, { consumeAdvance: false });
    expect(remaining).toBe(1515.83);
    expect(paymentToleranceGate('NORMAL', wizardPrefill(payment, false), remaining).action).toBe(
      'proceed',
    );
  });
});

describe('computeGateRemaining — behaviour unchanged when park = 0', () => {
  it('generic advance only: netted exactly as before', () => {
    const payment = makePayment({ installmentNo: 3, totalMonths: 12, advanceBalance: '500.00' });
    expect(computeGateRemaining(payment, { consumeAdvance: true })).toBe(1015.83);
  });

  it('no credit at all: remaining = amountDue + lateFee − amountPaid', () => {
    const payment = makePayment({
      installmentNo: 3,
      totalMonths: 12,
      lateFee: '100',
      amountPaid: '15.83',
    });
    expect(computeGateRemaining(payment, { consumeAdvance: true })).toBe(1600);
  });

  it('waiver reduces cash owed and is clamped to the gross late fee', () => {
    const payment = makePayment({ installmentNo: 3, totalMonths: 12, lateFee: '100' });
    expect(computeGateRemaining(payment, { consumeAdvance: true, lateFeeWaiverAmount: 40 })).toBe(
      1575.83,
    );
    // Over-waiving cannot dip below the base installment.
    expect(computeGateRemaining(payment, { consumeAdvance: true, lateFeeWaiverAmount: 500 })).toBe(
      1515.83,
    );
  });

  it('advance larger than owed never produces a negative remaining', () => {
    const payment = makePayment({ installmentNo: 3, totalMonths: 12, advanceBalance: '9999' });
    expect(computeGateRemaining(payment, { consumeAdvance: true })).toBe(0);
  });
});

describe('computeGateRemaining — no drift from the wizard prefill', () => {
  const cases: Array<[string, GateRemainingPayment]> = [
    ['last + park only', makePayment({ rescheduleAdvanceBalance: '857.00' })],
    [
      'last + both buckets',
      makePayment({ advanceBalance: '300', rescheduleAdvanceBalance: '857.00', lateFee: '50' }),
    ],
    [
      'mid-term + park',
      makePayment({ installmentNo: 5, rescheduleAdvanceBalance: '857.00', advanceBalance: '120' }),
    ],
    ['mid-term, nothing parked', makePayment({ installmentNo: 5, lateFee: '75' })],
  ];

  it.each(cases)('%s: gate remaining === wizard prefill', (_label, payment) => {
    const remaining = computeGateRemaining(payment, { consumeAdvance: true });
    expect(new Decimal(remaining).toFixed(2)).toBe(new Decimal(wizardPrefill(payment)).toFixed(2));
  });
});
