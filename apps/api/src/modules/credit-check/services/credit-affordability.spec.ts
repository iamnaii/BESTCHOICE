import { calculateAffordability } from './credit-affordability';

describe('verified installment affordability policy', () => {
  it.each([
    [15000, 9000, 0, 3000],
    [15000, 9000, 3000, 1500],
    [20000, 15000, 4000, 500],
    [20000, 6000, 7000, 1000],
    [20000, 19500, 0, 200],
    [15000, 16000, 0, 0],
    [15000, 7000, 6000, 0],
  ])('income %s expenses %s debt %s gives cap %s', (income, expenses, debt, expected) => {
    expect(calculateAffordability({ verifiedMonthlyIncome: income, livingExpenses: expenses,
      externalMonthlyDebt: debt, internalMonthlyDebt: 0 }).maximumMonthlyPayment).toBe(expected);
  });

  it('includes store commitments exactly once alongside external debt', () => {
    expect(calculateAffordability({ verifiedMonthlyIncome: 15000, livingExpenses: 9000,
      externalMonthlyDebt: 1000, internalMonthlyDebt: 2000 })).toMatchObject({
      totalMonthlyDebt: 3000, remainingIncome: 3000, maximumMonthlyPayment: 1500,
    });
  });

  it('rounds down with decimal arithmetic at the hundred-baht boundary', () => {
    expect(calculateAffordability({ verifiedMonthlyIncome: 20000, livingExpenses: 19400.01,
      externalMonthlyDebt: 0, internalMonthlyDebt: 0 }).maximumMonthlyPayment).toBe(200);
  });

  it.each([undefined, null, NaN, Infinity, -1])('rejects missing/invalid input %s instead of treating it as zero', value => {
    expect(() => calculateAffordability({ verifiedMonthlyIncome: 15000, livingExpenses: value as number,
      externalMonthlyDebt: 0, internalMonthlyDebt: 0 })).toThrow();
  });
});
