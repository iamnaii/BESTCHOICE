import { Decimal } from '@prisma/client/runtime/library';
import { splitReceipt, SplitReceiptInput } from './split-receipt';

const D = (v: string | number) => new Decimal(v);

// Base: 17K/12M standard fixture → installmentTotal = 1515.83 (accounting.md).
const base: Omit<SplitReceiptInput, 'delta'> = {
  installmentTotal: D('1515.83'),
  lateFee: D(0),
  priorPrincipalCleared: D(0),
  priorLateFeeBooked: D(0),
  advanceConsume: D(0),
  advanceCredit: D(0),
  isFinalReceipt: false,
};

describe('splitReceipt — per-receipt allocation (Σ-invariant primitive)', () => {
  it('pure partial: delta < principalRemaining clears only delta, leaves remainder', () => {
    const r = splitReceipt({ ...base, delta: D('800') });
    expect(r.principalCleared.toFixed(2)).toBe('800.00');
    expect(r.lateFeePortion.toFixed(2)).toBe('0.00');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('715.83');
  });

  it('COMPLETING a prior partial (the bug case): prior=800, delta=715.83 → clears 715.83, no throw, remainder 0', () => {
    const r = splitReceipt({ ...base, delta: D('715.83'), priorPrincipalCleared: D('800') });
    expect(r.principalCleared.toFixed(2)).toBe('715.83');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('late fee split: delta = installmentTotal + lateFee → principal + 42-1103 split, no rounding', () => {
    const r = splitReceipt({ ...base, lateFee: D('100'), delta: D('1615.83') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.lateFeePortion.toFixed(2)).toBe('100.00');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('overpay rounding (monthlyPayment > installmentTotal by 0.01) → 53-1503 gain', () => {
    const r = splitReceipt({ ...base, delta: D('1515.84') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.overpayRounding.toFixed(2)).toBe('0.01');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('underpay close on FINAL receipt (monthlyPayment < installmentTotal by 0.01) → 52-1104, full clear', () => {
    const r = splitReceipt({ ...base, delta: D('1515.82'), isFinalReceipt: true });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83'); // full clear incl. absorbed 0.01
    expect(r.underpayRounding.toFixed(2)).toBe('0.01');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('same 0.01 short but NOT final → stays partial, no 52-1104', () => {
    const r = splitReceipt({ ...base, delta: D('1515.82'), isFinalReceipt: false });
    expect(r.principalCleared.toFixed(2)).toBe('1515.82');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.01');
  });

  it('advance consume supplements delta toward the installment total', () => {
    const r = splitReceipt({ ...base, delta: D('700'), advanceConsume: D('815.83') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('advance credit (parked surplus) is removed before allocation — clean clear, no over-rounding', () => {
    const r = splitReceipt({ ...base, delta: D('2000'), advanceCredit: D('484.17') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('advance credit consumes the whole receipt (available = 0) → nothing allocated, full remainder', () => {
    // Boundary of the precondition advanceCredit ≤ delta + advanceConsume.
    const r = splitReceipt({ ...base, delta: D('1515.83'), advanceCredit: D('1515.83') });
    expect(r.principalCleared.toFixed(2)).toBe('0.00');
    expect(r.lateFeePortion.toFixed(2)).toBe('0.00');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('1515.83');
  });

  it('over-collection beyond tolerance surfaces as overpayRounding > 1 (template will reject/park)', () => {
    const r = splitReceipt({ ...base, delta: D('1600') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.overpayRounding.toFixed(2)).toBe('84.17');
  });
});
