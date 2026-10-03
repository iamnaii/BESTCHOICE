import { bkkYyyymmdd, documentNumberLayout } from './document-number-format.util';

describe('document numbering calendar shared by issuance and preview', () => {
  it.each([
    ['PREFIX-YYMM-NNN', '2701', 3],
    ['PREFIX-YYYYMM-NNNNN', '202701', 5],
    ['PREFIX-YYYY-NNNNNN', '2027', 6],
    ['PREFIX-YYYYMMDD-NNNN', '20270101', 4],
  ] as const)('preserves date and width for %s across Bangkok new year', (format, datePortion, seqWidth) => {
    expect(documentNumberLayout(new Date('2026-12-31T17:00:00Z'), format)).toEqual({ datePortion, seqWidth });
  });
  it('keeps the previous day before Bangkok midnight and handles leap day', () => {
    expect(bkkYyyymmdd(new Date('2026-12-31T16:59:59Z'))).toBe('20261231');
    expect(bkkYyyymmdd(new Date('2028-02-28T17:00:00Z'))).toBe('20280229');
  });
});
