import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { bcSheetRows } from './__fixtures__/bc-sheet-2026-11-23';
import { calcBcInstallment } from './installment-calc';
import { computeDefaultBcInstallment } from './default-bc-installment';
import { bcSheetAmounts } from './bc-sheet-amounts';

const config = { minDownPct: .15, commissionPct: .1, vatPct: .07,
  ratePctByMonths: { 10: .5, 12: .5 }, allowedMonths: [10, 12] };

describe('owner-approved sheet prices, all 53 model/storage/condition rows', () => {
  it.each(bcSheetRows)('$category $model $storage: $monthly × $months', row => {
    const quote = computeDefaultBcInstallment(row.price, config, { downAmount: row.down, months: row.months });
    expect(quote).toEqual({ downAmount: row.down, monthlyPayment: row.monthly, months: row.months });
    const result = calcBcInstallment({ installmentPrice: new Decimal(row.price),
      customDownAmount: new Decimal(row.down), months: row.months, config: {
        minDownPct: new Decimal('.15'), commissionPct: new Decimal('.1'), vatPct: new Decimal('.07'),
        allowedMonths: [10, 12], ratePctByMonths: new Map([[10, new Decimal('.5')], [12, new Decimal('.5')]]),
      } });
    expect(result.isValid).toBe(true);
    expect(result.totalWithVat.toNumber()).toBe(row.monthly * row.months);
    expect(result.financedAmount.plus(result.interestAmount).plus(result.commissionAmount).plus(result.vatAmount).eq(result.totalWithVat)).toBe(true);
    expect(result.totalWithVat.mul(7).div(107).toDecimalPlaces(2).eq(result.vatAmount)).toBe(true);
    expect(result.financeToShop.eq(result.financedAmount.plus(result.commissionAmount))).toBe(true);
  });

  it.each([
    { months: 6 }, { ratePct: '.3' }, { commissionPct: '.05' }, { vatPct: 0 }, { principal: '.01' },
  ])('does not change other configured policies or forgive principal: %j', override => {
    expect(bcSheetAmounts({ principal: 11900, months: 12, ratePct: '.5', commissionPct: '.1', vatPct: '.07', ...override })).toBeNull();
  });
});
