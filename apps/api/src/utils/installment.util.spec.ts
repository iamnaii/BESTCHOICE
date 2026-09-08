import { calculateInstallment, calculateInstallmentWithInterest, roundBaht } from './installment.util';

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
    expect(out.monthlyPayment).toBeCloseTo(2413.20, 2);
  });
});

describe('Contract math — feature flag off (legacy preserved)', () => {
  beforeAll(() => { process.env.USE_NEW_RATE_LOOKUP = 'false'; });
  afterAll(() => { delete process.env.USE_NEW_RATE_LOOKUP; });

  it('refactored bridge produces same output as legacy calculateInstallment for canonical inputs', () => {
    // This is a unit-level pin (NOT a service test) — verifies the bridge equivalence
    // for the same inputs that contracts.service uses internally.
    const sellingPrice = 19900;
    const downPayment = 2985;
    const interestRate = 0.04166667;     // 4.17%/month
    const months = 12;
    const commissionPct = 0.10;
    const vatPct = 0.07;

    const legacy = calculateInstallment(sellingPrice, downPayment, interestRate, months, commissionPct, vatPct);
    const ratePct = interestRate * months;     // simulates getRateForMonths flag-off
    const principal = roundBaht(sellingPrice - downPayment);
    const interestTotal = roundBaht(principal * ratePct);
    const refactor = calculateInstallmentWithInterest(sellingPrice, downPayment, interestTotal, months, commissionPct, vatPct);

    expect(refactor.monthlyPayment).toBeCloseTo(legacy.monthlyPayment, 2);
    expect(refactor.financedAmount).toBeCloseTo(legacy.financedAmount, 2);
    expect(refactor.interestTotal).toBeCloseTo(legacy.interestTotal, 2);
  });
});

  it('matches CPA rounding: 17000 before VAT / 12 floors to 1416.66 plus VAT 99.17', () => {
    const out = calculateInstallmentWithInterest(12500, 2500, 6000, 12, 0.10, 0.07);
    expect(out.financedAmount).toBe(18190);
    expect(out.monthlyPayment).toBe(1515.83);
  });

  it('keeps separate CPA rounding when rounding the gross monthly total would add one satang', () => {
    expect(calculateInstallmentWithInterest(10000, 2000, 2400, 12, 0.10, 0.07).monthlyPayment).toBe(998.66);
  });
