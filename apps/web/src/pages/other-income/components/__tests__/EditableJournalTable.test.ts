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

// re-review m2 (2026-11-01): ยอดเกิน 2 ตำแหน่ง — server ปฏิเสธ (DTO + V1) และบัญชีเก็บได้แค่ 2 ตำแหน่ง ⇒ หน้าจอต้องเตือนก่อนกด
// (การปัดต่อบรรทัดของ V1 ซ่อนกรณีนี้: 1.005×100 = 100.4999… ปัดลง ⇒ 200 = 200 สตางค์ ทั้งที่ server เห็น 2.005 = 2.005)
describe('getJournalIssues — amounts with more than 2 decimals', () => {
  it('flags Dr 50.005 + 50.005 / Cr 100.01', () => {
    const issues = getJournalIssues([
      { accountCode: '11-1101', debit: 50.005, credit: 0 },
      { accountCode: '11-1102', debit: 50.005, credit: 0 },
      { accountCode: '42-1102', debit: 0, credit: 100.01 },
    ]);
    const precision = issues.filter((i) => i.msg.includes('ทศนิยมเกิน 2 ตำแหน่ง'));
    expect(precision.map((i) => i.rule)).toEqual(['V1', 'V1']);
  });

  it('flags Dr 1.005 + 1.00 / Cr 1.0025 + 1.0025 even though the cent totals look equal', () => {
    const issues = getJournalIssues([
      { accountCode: '11-1101', debit: 1.005, credit: 0 },
      { accountCode: '11-1102', debit: 1, credit: 0 },
      { accountCode: '42-1102', debit: 0, credit: 1.0025 },
      { accountCode: '42-1103', debit: 0, credit: 1.0025 },
    ]);
    expect(issues.filter((i) => i.msg.includes('ทศนิยมเกิน 2 ตำแหน่ง'))).toHaveLength(3);
  });

  it('does not flag 2-decimal amounts (including floating-point-inexact ones)', () => {
    const issues = getJournalIssues([
      { accountCode: '42-1101', debit: 0.1, credit: 0 },
      { accountCode: '42-1102', debit: 0.2, credit: 0 },
      { accountCode: '52-1101', debit: 0, credit: 0.3 },
      { accountCode: '52-1102', debit: 1234.56, credit: 0 },
      { accountCode: '52-1103', debit: 0, credit: 1234.56 },
    ]);
    expect(issues).toEqual([]);
  });
});
