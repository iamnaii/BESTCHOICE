import { Prisma } from '@prisma/client';
import { poCostRemainder, poUnitCost, PoCostBasis } from './po-unit-cost.util';

/**
 * ต้นทุนต่อหน่วยของสินค้าที่รับเข้าจากใบสั่งซื้อ (คำตอบฝ่ายบัญชี 2026-09-29 ข้อ ข2 + ข5):
 * ต้นทุน = ส่วนแบ่งของยอดสุทธิที่ต้องจ่ายผู้จัดจำหน่าย (รวม VAT หลังส่วนลดท้ายบิล) ตามสัดส่วนราคา
 */
describe('po-unit-cost.util', () => {
  const basis = (totalAmount: string, netAmount: string, items: [number, string][]): PoCostBasis => ({
    totalAmount,
    netAmount,
    items: items.map(([quantity, unitPrice]) => ({ quantity, unitPrice })),
  });

  it('ข2 — เครื่องเดียว 10,000 + VAT 700 → ต้นทุน 10,700.00', () => {
    const b = basis('10000', '10700', [[1, '10000']]);
    expect(poUnitCost(b, '10000').toFixed(2)).toBe('10700.00');
    expect(poCostRemainder(b).toFixed(2)).toBe('0.00');
  });

  it('ข5 — ส่วนลดท้ายบิลก่อน VAT 300 แบ่งตามสัดส่วนราคา แล้วรวม VAT', () => {
    // A 10,000 + B 5,000 = 15,000 − 300 = 14,700 + VAT 1,029 = 15,729
    const b = basis('15000', '15729', [
      [1, '10000'],
      [1, '5000'],
    ]);
    expect(poUnitCost(b, '10000').toFixed(2)).toBe('10486.00');
    expect(poUnitCost(b, '5000').toFixed(2)).toBe('5243.00');
    expect(poCostRemainder(b).toFixed(2)).toBe('0.00');
  });

  it('ส่วนลดหลัง VAT ถูกแบ่งด้วย เพราะคิดจากยอดสุทธิที่ต้องจ่ายจริง', () => {
    // 2 × 1,000 = 2,000 − 100 = 1,900 + VAT 133 = 2,033 − 33 = 2,000
    const b = basis('2000', '2000', [[2, '1000']]);
    expect(poUnitCost(b, '1000').toFixed(2)).toBe('1000.00');
    expect(poCostRemainder(b).toFixed(2)).toBe('0.00');
  });

  it('ผู้จัดจำหน่ายไม่จด VAT และไม่มีส่วนลด → ต้นทุน = ราคาต่อหน่วย', () => {
    const b = basis('2000', '2000', [[2, '1000']]);
    expect(poUnitCost(b, '1000').toFixed(2)).toBe('1000.00');
  });

  it('เศษสตางค์จากการปัดรายหน่วยถูกรายงานเป็น remainder ให้ผู้เรียกลงหน่วยเดียว', () => {
    // 3 × 3,333.33 = 9,999.99 − ส่วนลด 0.01 = 9,999.98
    const b = basis('9999.99', '9999.98', [[3, '3333.33']]);
    expect(poUnitCost(b, '3333.33').toFixed(2)).toBe('3333.33');
    expect(poCostRemainder(b).toFixed(2)).toBe('-0.01');
  });

  it('ต้นทุนทุกหน่วย + remainder = ยอดสุทธิของใบสั่งซื้อพอดี (ใบผสมหลายรายการ)', () => {
    // 7 × 1,234.56 + 3 × 99.99 = 8,641.92 + 299.97 = 8,941.89 − 41.89 = 8,900 + VAT 623 = 9,523
    const items: [number, string][] = [
      [7, '1234.56'],
      [3, '99.99'],
    ];
    const b = basis('8941.89', '9523', items);
    const sum = items.reduce(
      (acc, [quantity, unitPrice]) => acc.add(poUnitCost(b, unitPrice).mul(quantity)),
      new Prisma.Decimal(0),
    );
    expect(sum.add(poCostRemainder(b)).toFixed(2)).toBe('9523.00');
  });

  it('ยอดรวมก่อนส่วนลดเป็นศูนย์ → ใช้ราคาต่อหน่วยตรง ๆ ไม่มี remainder', () => {
    const b = basis('0', '0', [[1, '0']]);
    expect(poUnitCost(b, '0').toFixed(2)).toBe('0.00');
    expect(poCostRemainder(b).toFixed(2)).toBe('0.00');
  });

  it('รับค่าเป็น Prisma.Decimal ได้ และคืน Prisma.Decimal', () => {
    const b: PoCostBasis = {
      totalAmount: new Prisma.Decimal('10000'),
      netAmount: new Prisma.Decimal('10700'),
      items: [{ quantity: 1, unitPrice: new Prisma.Decimal('10000') }],
    };
    expect(poUnitCost(b, new Prisma.Decimal('10000'))).toBeInstanceOf(Prisma.Decimal);
  });

  it('ยอดสุทธิติดลบ → RangeError (ผู้เรียกต้องดักก่อนและแจ้งผู้ใช้เป็นภาษาไทย)', () => {
    const b = basis('1000', '-50', [[1, '1000']]);
    expect(() => poUnitCost(b, '1000')).toThrow(RangeError);
    expect(() => poCostRemainder(b)).toThrow(RangeError);
  });
});
