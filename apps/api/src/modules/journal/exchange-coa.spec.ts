import * as path from 'path';
import { loadCoaFromCsv } from './__tests__/csv-fixture-loader';

const CSV = path.join(__dirname, '__tests__', 'fixtures', 'cpa-cases', 'finance-coa.csv');

/**
 * Device Swap CoA (spec §10) — REVERSED 2026-08-03 by CPA/owner instruction.
 *
 * 42-1106 (รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ) and 42-1107 (รายได้ค่าปรับ
 * ยกเลิกเปลี่ยนเครื่อง) were added by the Device Swap sprint and then never used:
 *  - 42-1106 was superseded by the single-standard release account Cr 51-1103
 *    (CPA ruling 2026-08-01, spec §13 A2.2 คำตอบ ข).
 *  - 42-1107's cancel-penalty rule was scrapped entirely by the owner 2026-07-31.
 * CPA then instructed both be REMOVED from the chart (not left dormant).
 *
 * These tests are the deliberate INVERSE of the originals: they used to assert the
 * two accounts EXIST; they now assert they are ABSENT, so a future re-introduction
 * into the canonical CSV (and therefore into every seeded environment) fails CI
 * instead of slipping back in silently.
 */
describe('Device Swap CoA (spec §10) — 42-1106 / 42-1107 removed (CPA 2026-08-03)', () => {
  const accounts = loadCoaFromCsv(CSV);
  const byCode = new Map(accounts.map((a: { code: string }) => [a.code, a]));

  it('42-1106 (ECL-reversal income) is absent — superseded by Cr 51-1103', () => {
    expect(byCode.get('42-1106')).toBeUndefined();
  });

  it('42-1107 (exchange-cancel penalty income) is absent — penalty rule scrapped', () => {
    expect(byCode.get('42-1107')).toBeUndefined();
  });

  it('the surrounding 42-11XX block is otherwise intact (removal was surgical)', () => {
    const otherIncome = accounts
      .map((a: { code: string }) => a.code)
      .filter((c: string) => c.startsWith('42-11'));
    expect(otherIncome).toEqual(['42-1102', '42-1103', '42-1104', '42-1105']);
  });
});
