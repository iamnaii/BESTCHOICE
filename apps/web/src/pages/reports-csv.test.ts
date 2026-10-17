import { describe, expect, it } from 'vitest';
import { contractsCsv } from './reports-csv';

describe('contract report CSV', () => {
  it('exports UTF-8 Thai headers and quoted records, including embedded commas, quotes and newlines', () => {
    const csv = contractsCsv([{ contractNumber: 'TEST-01', customerName: 'สมชาย, "ทดสอบ"\nบรรทัดสอง', sellingPrice: 1234.5 }]);
    expect(csv.startsWith('\uFEFF"เลขที่สัญญา","สถานะ","ลูกค้า"')).toBe(true);
    expect(csv).toContain('"สมชาย, ""ทดสอบ""\nบรรทัดสอง"');
    expect(csv).toContain('"1234.5"');
    expect(csv).not.toContain('[object Object]');
  });

  it('neutralizes spreadsheet formulas from text while retaining numeric values', () => {
    const csv = contractsCsv([{ customerName: '=HYPERLINK("https://example.invalid")', customerPhone: '+66800000000', sellingPrice: -100 }]);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
    expect(csv).toContain('"\'+66800000000"');
    expect(csv).toContain('"-100"');
    expect(contractsCsv([]).split(',')).toHaveLength(19);
  });
});
