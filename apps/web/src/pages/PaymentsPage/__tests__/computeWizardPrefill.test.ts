import { describe, it, expect } from 'vitest';
import { computeWizardPrefill } from '../computeWizardPrefill';
import { computeNetReceiptDue } from '../computeNetReceiptDue';

describe('computeWizardPrefill (RecordPaymentWizard first-render amount)', () => {
  it('INCLUDES the late fee in the prefill (the bug: full must mean base + fee)', () => {
    // 3671 base + 100 fee, nothing paid → เต็มงวด = 3771 (not 3671)
    expect(
      computeWizardPrefill({ amountDue: '3671', lateFee: '100', amountPaid: '0' }).toFixed(2),
    ).toBe('3771.00');
  });

  it('nets out what has already been paid on the installment', () => {
    expect(
      computeWizardPrefill({ amountDue: '3671', lateFee: '100', amountPaid: '2000' }).toFixed(2),
    ).toBe('1771.00');
  });

  it('leaves only the late fee once the base is settled', () => {
    expect(
      computeWizardPrefill({ amountDue: '3671', lateFee: '100', amountPaid: '3671' }).toFixed(2),
    ).toBe('100.00');
  });

  it('shows the FULL owed on first render — advance is NOT pre-deducted (auto-sync applies it later)', () => {
    const input = { amountDue: '3671', lateFee: '100', amountPaid: '0' } as const;
    const prefill = computeWizardPrefill(input);
    // What the auto-sync effect computes once the advance/consume inputs are wired in.
    const afterAdvance = computeNetReceiptDue({ ...input, advanceBalance: '500', consumeAdvance: true });

    expect(prefill.toFixed(2)).toBe('3771.00');
    expect(afterAdvance.toFixed(2)).toBe('3271.00');
    // The initial prefill is intentionally HIGHER — it omits the advance deduction.
    expect(prefill.gt(afterAdvance)).toBe(true);
  });
});
