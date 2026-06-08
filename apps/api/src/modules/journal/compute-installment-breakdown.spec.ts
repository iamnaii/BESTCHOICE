import { Decimal } from '@prisma/client/runtime/library';
import { computeInstallmentBreakdown } from './compute-installment-breakdown';

/**
 * Golden for the SINGLE source-of-truth per-installment breakdown.
 *
 * The same derivation — financed + commission(default 10%) + interest → gross;
 * vat(default 7%); installmentExclVat = gross/months ROUND_DOWN; interestPerInst
 * & vatPerInst = .../months ROUND_HALF_UP; installmentTotal = exclVat + vatPerInst
 * — was copy-pasted into 2A, 2B, 2B-split and the early-payoff JE. This pins the
 * canonical values so every caller stays satang-identical.
 *
 * Rounding (.claude/rules/accounting.md): grossExclVat/months ROUND_DOWN;
 * interest/months + vat/months ROUND_HALF_UP; per-installment total = sum.
 */
describe('computeInstallmentBreakdown (single-source per-installment math)', () => {
  it('CPA case-4 (17K/12M): 1416.66 / 500.00 / 99.17 → installmentTotal 1515.83', () => {
    const b = computeInstallmentBreakdown({
      financedAmount: '10000',
      storeCommission: '1000',
      interestTotal: '6000',
      vatAmount: '1190',
      totalMonths: 12,
    });
    expect(b.grossExclVat.toFixed(2)).toBe('17000.00');
    expect(b.vat.toFixed(2)).toBe('1190.00');
    expect(b.installmentExclVat.toFixed(2)).toBe('1416.66'); // ROUND_DOWN (not .67)
    expect(b.interestPerInst.toFixed(2)).toBe('500.00');
    expect(b.vatPerInst.toFixed(2)).toBe('99.17'); // ROUND_HALF_UP
    expect(b.installmentTotal.toFixed(2)).toBe('1515.83');
  });

  it('18K/12M: 1800.00 / 150.00 / 126.00 → installmentTotal 1926.00', () => {
    const b = computeInstallmentBreakdown({
      financedAmount: '18000',
      storeCommission: '1800',
      interestTotal: '1800',
      vatAmount: '1512',
      totalMonths: 12,
    });
    expect(b.grossExclVat.toFixed(2)).toBe('21600.00');
    expect(b.installmentExclVat.toFixed(2)).toBe('1800.00');
    expect(b.interestPerInst.toFixed(2)).toBe('150.00');
    expect(b.vatPerInst.toFixed(2)).toBe('126.00');
    expect(b.installmentTotal.toFixed(2)).toBe('1926.00');
  });

  it('null storeCommission → financed × 10%', () => {
    const b = computeInstallmentBreakdown({
      financedAmount: '10000',
      storeCommission: null,
      interestTotal: '6000',
      vatAmount: '1190',
      totalMonths: 12,
    });
    expect(b.commission.toFixed(2)).toBe('1000.00');
    expect(b.installmentTotal.toFixed(2)).toBe('1515.83');
  });

  it('null vatAmount → grossExclVat × 7%', () => {
    const b = computeInstallmentBreakdown({
      financedAmount: '10000',
      storeCommission: '1000',
      interestTotal: '6000',
      vatAmount: null,
      totalMonths: 12,
    });
    expect(b.vat.toFixed(2)).toBe('1190.00'); // 17000 × 0.07
    expect(b.vatPerInst.toFixed(2)).toBe('99.17');
    expect(b.installmentTotal.toFixed(2)).toBe('1515.83');
  });

  it('accepts Decimal / string / number inputs interchangeably', () => {
    const asStr = computeInstallmentBreakdown({
      financedAmount: '10000', storeCommission: '1000', interestTotal: '6000', vatAmount: '1190', totalMonths: 12,
    });
    const asDec = computeInstallmentBreakdown({
      financedAmount: new Decimal('10000'), storeCommission: new Decimal('1000'),
      interestTotal: new Decimal('6000'), vatAmount: new Decimal('1190'), totalMonths: 12,
    });
    const asNum = computeInstallmentBreakdown({
      financedAmount: 10000, storeCommission: 1000, interestTotal: 6000, vatAmount: 1190, totalMonths: 12,
    });
    expect(asStr.installmentTotal.toFixed(2)).toBe('1515.83');
    expect(asDec.installmentTotal.toFixed(2)).toBe('1515.83');
    expect(asNum.installmentTotal.toFixed(2)).toBe('1515.83');
  });
});
