import { Prisma } from '@prisma/client';
import { poLineVats, poUnitVatAt } from './po-unit-vat.util';

/** ภาษีซื้อต่อหน่วย (ก้อน 5 · ฝ่ายบัญชี 2.2 — แบ่ง VAT ของใบตามสัดส่วนราคา: A 686 / B 343 จาก 1,029) */
describe('po-unit-vat.util', () => {
  const lines = [
    { id: 'A', quantity: 1, unitPrice: '9800', createdAt: new Date('2026-10-01') },
    { id: 'B', quantity: 1, unitPrice: '4900', createdAt: new Date('2026-10-02') },
  ];

  it('ปัน 1,029 เป็น A 686.00 / B 343.00 (สัดส่วนราคา 2:1)', () => {
    const vats = poLineVats({ vatAmount: '1029', lines });
    expect(vats.get('A')!.toFixed(2)).toBe('686.00');
    expect(vats.get('B')!.toFixed(2)).toBe('343.00');
  });

  it('ผู้จัดจำหน่ายไม่จด VAT (vatAmount 0) → ทุกรายการ 0.00', () => {
    const vats = poLineVats({ vatAmount: 0, lines });
    expect(vats.get('A')!.toFixed(2)).toBe('0.00');
    expect(vats.get('B')!.toFixed(2)).toBe('0.00');
  });

  it('หน่วยในรายการเดียวกันปัดสะสม — 3 หน่วย VAT 100 → 33.33 / 33.34 / 33.33 (round(k/3·100) − round((k−1)/3·100)) รวม 100.00 พอดี', () => {
    const units = [1, 2, 3].map((k) => poUnitVatAt('100', 3, k));
    expect(units.map((u) => u.toFixed(2))).toEqual(['33.33', '33.34', '33.33']);
    expect(units.reduce((s, u) => s.plus(u), new Prisma.Decimal(0)).toFixed(2)).toBe('100.00');
  });

  it('vatAmount ติดลบ → RangeError (กติกาเดียวกับต้นทุน)', () => {
    expect(() => poLineVats({ vatAmount: '-1', lines })).toThrow(RangeError);
  });
});
