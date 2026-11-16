import { describe, expect, it } from 'vitest';
import { pettyCashTotals } from '../petty-cash-totals';
import { newPettyCashLine } from '../types';

describe('pettyCashTotals', () => {
  it('คิด VAT ต่อบรรทัดแล้วรวม', () => {
    const totals = pettyCashTotals({
      custodianName: '',
      lines: [
        newPettyCashLine({ uid: 'a', amount: '100', vatPercent: '7' }),
        newPettyCashLine({ uid: 'b', amount: '50.50', vatPercent: '0' }),
      ],
    });
    expect(totals.lines).toEqual([
      { uid: 'a', base: 100, vat: 7, total: 107 },
      { uid: 'b', base: 50.5, vat: 0, total: 50.5 },
    ]);
    expect(totals.sumBase).toBe(150.5);
    expect(totals.sumVat).toBe(7);
    expect(totals.sumTotal).toBe(157.5);
  });

  it('บรรทัดที่ยังไม่กรอกยอดนับเป็นศูนย์', () => {
    const totals = pettyCashTotals({ custodianName: '', lines: [newPettyCashLine({ uid: 'a' })] });
    expect(totals).toMatchObject({ sumBase: 0, sumVat: 0, sumTotal: 0 });
  });
});
