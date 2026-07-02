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

  // Owner directive 2026-07-02: late fee books FIRST — the receipt that collects
  // cash books Cr 42-1103 before clearing 11-2103, so the ledger matches the
  // receipt document (fee displays on the first receipt).
  describe('fee-first allocation on partial receipts (owner 2026-07-02)', () => {
    // Mockup case TEST-20260630-003: installment 4,472 + late fee 100, partial 2,572.
    const partialBase = {
      ...base,
      installmentTotal: D('4472.00'),
      lateFee: D('100'),
    };

    it('first partial receipt books the fee first: 2,572 → Cr 42-1103 = 100 + Cr 11-2103 = 2,472', () => {
      const r = splitReceipt({ ...partialBase, delta: D('2572') });
      expect(r.lateFeePortion.toFixed(2)).toBe('100.00');
      expect(r.principalCleared.toFixed(2)).toBe('2472.00');
      expect(r.overpayRounding.toFixed(2)).toBe('0.00');
      expect(r.underpayRounding.toFixed(2)).toBe('0.00');
      expect(r.principalRemainingAfter.toFixed(2)).toBe('2000.00');
    });

    it('follow-up receipt with fee already booked: 2,000 → principal only, no double 42-1103', () => {
      const r = splitReceipt({
        ...partialBase,
        delta: D('2000'),
        priorPrincipalCleared: D('2472'),
        priorLateFeeBooked: D('100'),
        isFinalReceipt: true,
      });
      expect(r.lateFeePortion.toFixed(2)).toBe('0.00');
      expect(r.principalCleared.toFixed(2)).toBe('2000.00');
      expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
    });

    it('tiny partial smaller than the fee: 50 → all to 42-1103, nothing to principal', () => {
      const r = splitReceipt({ ...partialBase, delta: D('50') });
      expect(r.lateFeePortion.toFixed(2)).toBe('50.00');
      expect(r.principalCleared.toFixed(2)).toBe('0.00');
      expect(r.principalRemainingAfter.toFixed(2)).toBe('4472.00');
    });

    it('final receipt short ≤1฿ lands on PRINCIPAL (52-1104 close) — fee income stays gross', () => {
      // Full obligation 4,572; pays 4,571.50 in one final receipt.
      const r = splitReceipt({ ...partialBase, delta: D('4571.50'), isFinalReceipt: true });
      expect(r.lateFeePortion.toFixed(2)).toBe('100.00'); // fee never shorted
      expect(r.underpayRounding.toFixed(2)).toBe('0.50');
      expect(r.principalCleared.toFixed(2)).toBe('4472.00'); // full clear incl. absorbed 0.50
      expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
    });
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
