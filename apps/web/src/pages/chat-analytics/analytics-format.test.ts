import { describe, it, expect } from 'vitest';
import { formatMetric, formatDocumentAmount, bangkokPeriod, csvCell } from './analytics-format';
describe('Analytics honest values and date boundaries', () => {
  it('keeps missing evidence different from real zero', () => {
    expect(formatMetric(null, 'นาที')).toBe('ยังไม่มีข้อมูล');
    expect(formatMetric(0, 'นาที')).toBe('0 นาที');
    expect(formatMetric(1.25, 'นาที')).toBe('1.25 นาที');
  });
  it('keeps money as a decimal string and uses exclusive Bangkok end', () => {
    expect(formatDocumentAmount('12345678901234.50')).toBe('12,345,678,901,234.50 บาท');
    expect(bangkokPeriod('2026-10-05', '2026-10-05')).toEqual({
      from: '2026-10-05T00:00:00+07:00',
      to: '2026-10-06T00:00:00+07:00',
    });
  });
  it('exports untrusted names as CSV text, including whitespace-prefixed formulas', () => {
    expect(csvCell('\t=1+1')).toBe('"\'\t=1+1"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});
