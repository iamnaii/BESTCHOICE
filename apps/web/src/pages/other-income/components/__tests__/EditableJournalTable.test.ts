import { describe, it, expect } from 'vitest';
import { getJournalIssues } from '../EditableJournalTable';

// V1 ต้องเท่ากันพอดีเหมือนฝั่ง server (`isJournalBalanced` — คำตัดสินเจ้าของ 31 ต.ค. 2026 "ลดเป็นศูนย์")
describe('getJournalIssues — V1 Dr = Cr', () => {
  it('flags a 0.01 difference', () => {
    const issues = getJournalIssues([
      { accountCode: '42-1101', debit: 100, credit: 0 },
      { accountCode: '52-1101', debit: 0, credit: 99.99 },
    ]);
    expect(issues.map((i) => i.rule)).toContain('V1');
    expect(issues.find((i) => i.rule === 'V1')?.msg).toContain('ผลต่าง 0.01 บาท');
  });

  it('passes when totals are equal, including amounts that are inexact in floating point', () => {
    const issues = getJournalIssues([
      { accountCode: '42-1101', debit: 0.1, credit: 0 },
      { accountCode: '42-1102', debit: 0.2, credit: 0 },
      { accountCode: '52-1101', debit: 0, credit: 0.3 },
    ]);
    expect(issues.map((i) => i.rule)).not.toContain('V1');
  });
});
