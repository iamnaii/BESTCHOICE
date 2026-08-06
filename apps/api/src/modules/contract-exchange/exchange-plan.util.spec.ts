import { Decimal } from '@prisma/client/runtime/library';
import { computeExchangePlan } from './exchange-plan.util';

describe('computeExchangePlan (rounding per accounting.md)', () => {
  it('workbook fixture: 10,000 / 12 งวด / rate 0.05 → monthly 1,515.83', () => {
    const p = computeExchangePlan({
      newPrice: new Decimal('10000'),
      months: 12,
      monthlyRate: new Decimal('0.05'),
    });
    expect(p.financedAmount.toString()).toBe('10000');
    expect(p.storeCommission.toString()).toBe('1000');    // 10%
    expect(p.interestTotal.toString()).toBe('6000');      // 10000×0.05×12
    expect(p.grossExclVat.toString()).toBe('17000');
    expect(p.vatAmount.toString()).toBe('1190');          // 7% HALF_UP
    // 17000/12 ROUND_DOWN = 1416.66 + 1190/12 HALF_UP = 99.17 → 1515.83
    expect(p.monthlyPayment.toString()).toBe('1515.83');
  });
});
