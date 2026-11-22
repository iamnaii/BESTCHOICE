import { describe, expect, it } from 'vitest';
import { computeDefaultBcInstallment } from './default-bc-installment';
const config = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 6: 0.4, 12: 0.5 },
  allowedMonths: [6, 12],
};
describe('default stock quotes with model terms', () => {
  it('preserves existing defaults when there are no terms', () => {
    expect(computeDefaultBcInstallment(19900, config)).toEqual({
      months: 12,
      downAmount: 3000,
      monthlyPayment: 2411.06,
    });
  });
  it('uses an allowed template term and custom down without rounding it to the minimum', () => {
    const quote = computeDefaultBcInstallment(19900, config, { months: 6, downAmount: 5001 });
    expect(quote).toMatchObject({ months: 6, downAmount: 5001 });
    expect(quote?.monthlyPayment).toBeGreaterThan(0);
  });
  it('falls back for unsupported terms or invalid down and never emits nonfinite results', () => {
    expect(computeDefaultBcInstallment(19900, config, { months: 15, downAmount: NaN })).toEqual(
      computeDefaultBcInstallment(19900, config),
    );
    expect(
      computeDefaultBcInstallment(
        19900,
        { ...config, vatPct: NaN },
        { months: 6, downAmount: 5000 },
      ),
    ).toBeNull();
  });
});
