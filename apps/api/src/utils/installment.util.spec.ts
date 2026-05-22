import { calculateInstallment, calculateInstallmentWithInterest } from './installment.util';

describe('calculateInstallment ↔ calculateInstallmentWithInterest equivalence', () => {
  it('produces identical output for the same (rate × months) interest', () => {
    const sellingPrice = 19900;
    const downPayment = 2985;
    const rate = 0.04166667;          // 4.17% per month
    const months = 12;
    const commissionPct = 0.10;
    const vatPct = 0.07;
    const principal = sellingPrice - downPayment;

    const legacy = calculateInstallment(sellingPrice, downPayment, rate, months, commissionPct, vatPct);
    const refactor = calculateInstallmentWithInterest(
      sellingPrice,
      downPayment,
      rate * principal * months,    // resolve interest the same way calculateInstallment does internally
      months,
      commissionPct,
      vatPct,
    );

    expect(refactor.principal).toBe(legacy.principal);
    expect(refactor.interestTotal).toBeCloseTo(legacy.interestTotal, 2);
    expect(refactor.storeCommission).toBe(legacy.storeCommission);
    expect(refactor.vatAmount).toBeCloseTo(legacy.vatAmount, 2);
    expect(refactor.financedAmount).toBeCloseTo(legacy.financedAmount, 2);
    expect(refactor.monthlyPayment).toBeCloseTo(legacy.monthlyPayment, 2);
  });

  it('produces same output as calculateInstallment for the canonical worked example', () => {
    // installmentPrice 19,900, 15% down, 12 mo, 50% total rate, 10% commission, 7% vat
    // financed = 16,915, interest = 16,915 × 0.50 = 8,457.50
    const out = calculateInstallmentWithInterest(19900, 2985, 8457.50, 12, 0.10, 0.07);
    expect(out.financedAmount).toBeCloseTo(28958.48, 2);    // financed + interest + comm + vat
    expect(out.monthlyPayment).toBeCloseTo(2413.21, 2);
  });
});
