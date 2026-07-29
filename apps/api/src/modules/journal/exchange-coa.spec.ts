import * as path from 'path';
import { loadCoaFromCsv } from './__tests__/csv-fixture-loader';

const CSV = path.join(__dirname, '__tests__', 'fixtures', 'cpa-cases', 'finance-coa.csv');

describe('Device Swap CoA (spec §10)', () => {
  const accounts = loadCoaFromCsv(CSV);
  const byCode = new Map(accounts.map((a: { code: string }) => [a.code, a]));

  it('42-1106 renamed to ECL-reversal income (repair-income orphan repurposed)', () => {
    const a = byCode.get('42-1106') as { name: string } | undefined;
    expect(a).toBeDefined();
    expect(a!.name).toBe('รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ');
  });

  it('42-1107 exchange-cancel penalty income exists (Cr-normal, no VAT)', () => {
    const a = byCode.get('42-1107') as { name: string; normalBalance?: string } | undefined;
    expect(a).toBeDefined();
    expect(a!.name).toBe('รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง');
  });
});
