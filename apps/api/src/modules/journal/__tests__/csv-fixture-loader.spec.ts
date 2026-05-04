import { describe, it, expect } from 'vitest';
import { loadCoaFromCsv, loadCaseFromCsv } from './csv-fixture-loader';
import path from 'path';

const FIX = path.join(__dirname, 'fixtures/cpa-cases');

describe('csv-fixture-loader', () => {
  it('loads CoA with 100+ accounts', () => {
    const accounts = loadCoaFromCsv(path.join(FIX, 'finance-coa.csv'));
    expect(accounts.length).toBeGreaterThanOrEqual(90);
    const cash = accounts.find((a) => a.code === '11-1101');
    expect(cash).toMatchObject({
      code: '11-1101',
      name: 'เงินสด - สุทธินีย์ คงเดช',
      type: 'สินทรัพย์',
      normalBalance: 'Dr',
      vatApplicable: false,
    });
  });

  it('loads case-1-overpay with multiple JE blocks', () => {
    const cas = loadCaseFromCsv(path.join(FIX, 'case-1-overpay.csv'));
    expect(cas.entries.length).toBeGreaterThan(0);
    // First block should contain 11-2101 with Dr=17000.00
    const allLines = cas.entries.flatMap((e) => e.lines);
    expect(allLines).toContainEqual(
      expect.objectContaining({ code: '11-2101', dr: '17000.00' }),
    );
  });
});
