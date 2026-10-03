import { escapeHtml, fmtDateShort, fmtMoney, formatAddress } from './document-format.util';

describe('shared document formatting', () => {
  it('uses the Bangkok calendar day and Buddhist year across a UTC boundary', () => {
    expect(fmtDateShort('2026-10-02T18:00:00Z')).toBe('03/10/2569');
    expect(fmtDateShort(new Date('2026-10-02T16:59:59Z'))).toBe('02/10/2569');
    expect(fmtDateShort(null)).toBe('—');
    expect(fmtDateShort('invalid')).toBe('—');
  });

  it('preserves decimal, missing-value and non-finite money display', () => {
    expect(fmtMoney('1234.5')).toBe('1,234.50');
    expect(fmtMoney(-1234.5)).toBe('-1,234.50');
    expect(fmtMoney(undefined)).toBe('0.00');
    expect(fmtMoney(Infinity)).toBe('0.00');
  });

  it('escapes document text without allowing HTML markup', () => {
    expect(escapeHtml(`<script a="'">&`)).toBe('&lt;script a=&quot;&#039;&quot;&gt;&amp;');
    expect(escapeHtml(null)).toBe('');
  });

  it('supports both structured and legacy plain-text addresses', () => {
    expect(formatAddress('  Bangkok  ')).toBe('Bangkok');
    expect(formatAddress('{invalid')).toBe('{invalid');
    expect(formatAddress(JSON.stringify({ raw: 'ที่อยู่เดิม' }))).toBe('ที่อยู่เดิม');
    expect(formatAddress(JSON.stringify({ houseNo: '1', soi: '2', district: 'เมือง', province: 'เชียงใหม่', postalCode: '50000' }))).toBe('เลขที่ 1 ซอย 2 อำเภอเมือง จังหวัดเชียงใหม่ 50000');
  });
});
