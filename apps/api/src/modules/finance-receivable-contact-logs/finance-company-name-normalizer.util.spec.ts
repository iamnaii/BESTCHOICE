import { normalizeFinanceCompanyName } from './finance-company-name-normalizer.util';

describe('normalizeFinanceCompanyName', () => {
  it('trims whitespace', () => {
    expect(normalizeFinanceCompanyName('  เคทีซี  ')).toBe('เคทีซี');
  });

  it('lowercases ASCII letters', () => {
    expect(normalizeFinanceCompanyName('KTC Finance')).toBe('ktc finance');
  });

  it('collapses multiple internal spaces to single space', () => {
    expect(normalizeFinanceCompanyName('กสิกร   ไทย')).toBe('กสิกร ไทย');
  });

  it('strips spaces around parentheses', () => {
    expect(normalizeFinanceCompanyName('กสิกร (KK)')).toBe('กสิกร(kk)');
  });

  it('returns empty string for null / empty input', () => {
    expect(normalizeFinanceCompanyName('')).toBe('');
    expect(normalizeFinanceCompanyName(null as unknown as string)).toBe('');
  });
});
