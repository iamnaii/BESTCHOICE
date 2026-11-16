import { describe, expect, it } from 'vitest';
import { settlementTotals } from '../settlement-totals';
import type { SettlementFormFields } from '../types';

const fields = (over: Partial<SettlementFormFields> = {}): SettlementFormFields => ({
  selections: new Map(), vendorName: '', vendorSupplierId: '', whtAmount: '', whtFormType: '', ...over,
});

describe('settlementTotals', () => {
  it('ยังไม่เลือกใบใด ทุกยอดเป็นศูนย์', () => {
    expect(settlementTotals(fields())).toEqual({ count: 0, sumSelected: 0, wht: 0, cashLeg: 0 });
  });

  it('รวมยอดที่จ่ายของใบที่เลือก แล้วหักภาษีหัก ณ ที่จ่าย', () => {
    const selections = new Map([
      ['a', { docId: 'a', amount: '1000.00' }],
      ['b', { docId: 'b', amount: '250.50' }],
    ]);
    expect(settlementTotals(fields({ selections, whtAmount: '30' }))).toEqual({
      count: 2, sumSelected: 1250.5, wht: 30, cashLeg: 1220.5,
    });
  });

  it('ยอดที่พิมพ์ไม่เป็นตัวเลขนับเป็นศูนย์', () => {
    const selections = new Map([['a', { docId: 'a', amount: '' }]]);
    expect(settlementTotals(fields({ selections, whtAmount: 'x' }))).toEqual({
      count: 1, sumSelected: 0, wht: 0, cashLeg: 0,
    });
  });
});
