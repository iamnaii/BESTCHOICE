import { Prisma } from '@prisma/client';
import { computePoAmounts } from './po-amounts.util';
import { PoCostLine, poLineCosts, poUnitCostAt, poUnitCosts } from './po-unit-cost.util';

/**
 * ต้นทุนต่อหน่วยของสินค้าที่รับเข้าจากใบสั่งซื้อ (คำตอบฝ่ายบัญชี 2026-09-29 ข้อ ข2 + ข5):
 * ต้นทุน = ส่วนแบ่งของยอดสุทธิที่ต้องจ่ายผู้จัดจำหน่าย (รวม VAT หลังส่วนลดท้ายบิล) ตามสัดส่วนราคา
 *
 * ปันแบบ "ปัดสะสม" สองชั้น (รายการ → หน่วย) — ผลรวมเท่ายอดสุทธิพอดีโดยโครงสร้าง ไม่มีเศษเหลือให้ลงทีหลัง
 */
describe('po-unit-cost.util', () => {
  const D = (v: string | number) => new Prisma.Decimal(v);
  const lines = (...rows: [string, number, string][]): PoCostLine[] =>
    rows.map(([id, quantity, unitPrice], i) => ({
      id,
      quantity,
      unitPrice,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)),
    }));
  const allUnitCosts = (net: string, ls: PoCostLine[]) => {
    const byLine = poLineCosts({ netAmount: net, lines: ls });
    return ls.map((l) => poUnitCosts(byLine.get(l.id)!, l.quantity, 1, l.quantity).map((c) => c.toFixed(2)));
  };
  const total = (groups: string[][]) =>
    groups.flat().reduce((s, c) => s.add(c), D(0)).toFixed(2);

  it('ข2 — เครื่องเดียว 10,000 + VAT 700 → ต้นทุน 10,700.00', () => {
    expect(allUnitCosts('10700', lines(['a', 1, '10000']))).toEqual([['10700.00']]);
  });

  it('ข5 — ส่วนลดท้ายบิลก่อน VAT 300 แบ่งตามสัดส่วนราคา แล้วรวม VAT', () => {
    // A 10,000 + B 5,000 = 15,000 − 300 = 14,700 + VAT 1,029 = 15,729
    expect(allUnitCosts('15729', lines(['a', 1, '10000'], ['b', 1, '5000']))).toEqual([['10486.00'], ['5243.00']]);
  });

  it('ส่วนลดหลัง VAT ถูกแบ่งด้วย — คิดจากยอดสุทธิที่ computePoAmounts คำนวณ', () => {
    // 3 × 3,333.33 = 9,999.99 + VAT 700.00 = 10,699.99 − ส่วนลดหลัง VAT 0.50 = 10,699.49
    const amounts = computePoAmounts([{ quantity: 3, unitPrice: '3333.33' }], {
      supplierHasVat: true,
      vatRate: 0.07,
      discountAfterVat: 0.5,
    });
    expect(amounts.netAmount.toFixed(2)).toBe('10699.49');
    const costs = allUnitCosts(amounts.netAmount.toFixed(2), lines(['a', 3, '3333.33']));
    expect(costs).toEqual([['3566.50', '3566.49', '3566.50']]);
    expect(total(costs)).toBe('10699.49');
  });

  it('ผู้จัดจำหน่ายไม่จด VAT และไม่มีส่วนลด → ต้นทุน = ราคาต่อหน่วย', () => {
    expect(allUnitCosts('2000', lines(['a', 2, '1000']))).toEqual([['1000.00', '1000.00']]);
  });

  it('เศษสตางค์กระจายในรายการเดียวกัน ต่างกันไม่เกิน 1 สตางค์ และรวมเท่ายอดสุทธิ', () => {
    // 3 × 3,333.33 = 9,999.99 − ส่วนลด 0.01 = 9,999.98
    const costs = allUnitCosts('9999.98', lines(['a', 3, '3333.33']));
    expect(costs).toEqual([['3333.33', '3333.32', '3333.33']]);
    expect(total(costs)).toBe('9999.98');
  });

  it('หน่วยราคาถูกจำนวนมาก + ส่วนลด: ไม่มีหน่วยไหนติดลบ และรวมเท่ายอดสุทธิ', () => {
    // 1,000 × 1.00 − ส่วนลด 4.99 = 995.01 — วิธี "ปัดรายหน่วยแล้วลงเศษหน่วยเดียว" จะได้เศษ −4.99 ลงหน่วยราคา 1.00
    const costs = allUnitCosts('995.01', lines(['a', 1000, '1']));
    expect(total(costs)).toBe('995.01');
    const distinct = [...new Set(costs[0])].sort();
    expect(distinct).toEqual(['0.99', '1.00']);
  });

  it('รายการราคาศูนย์ (ของแถมจากผู้จัดจำหน่าย) ได้ต้นทุนศูนย์ ไม่รับเศษของรายการอื่น', () => {
    // 3 × 3,333.33 + ของแถม 1 ชิ้น ราคา 0 · ส่วนลด 100 → 9,899.99
    const costs = allUnitCosts('9899.99', lines(['phone', 3, '3333.33'], ['gift', 1, '0']));
    expect(costs[1]).toEqual(['0.00']);
    expect(total([costs[0]])).toBe('9899.99');
    expect(costs[0].every((c) => D(c).gte('3299.99') && D(c).lte('3300.00'))).toBe(true);
  });

  it('ใบผสมหลายรายการ: ต้นทุนทุกหน่วยรวมกัน = ยอดสุทธิ และทุกหน่วยอยู่ใกล้ราคาตามสัดส่วน', () => {
    // 7 × 1,234.56 + 3 × 99.99 = 8,941.89 − 41.89 = 8,900 + VAT 623 = 9,523
    const ls = lines(['a', 7, '1234.56'], ['b', 3, '99.99']);
    const costs = allUnitCosts('9523', ls);
    expect(total(costs)).toBe('9523.00');
    // สัดส่วนจริง: 9,523 × 1,234.56 ÷ 8,941.89 = 1,314.787… · 9,523 × 99.99 ÷ 8,941.89 = 106.487…
    expect(costs[0].every((c) => D(c).sub('1314.79').abs().lte('0.01'))).toBe(true);
    expect(costs[1].every((c) => D(c).sub('106.49').abs().lte('0.01'))).toBe(true);
  });

  it('ผลไม่ขึ้นกับลำดับที่ส่งรายการเข้ามา (เรียงตามเวลาสร้างแล้วตาม id)', () => {
    const forward = lines(['a', 2, '3333.33'], ['b', 1, '0.15']);
    const reversed = [...forward].reverse();
    const x = poLineCosts({ netAmount: '6000.41', lines: forward });
    const y = poLineCosts({ netAmount: '6000.41', lines: reversed });
    expect(y.get('a')!.toFixed(2)).toBe(x.get('a')!.toFixed(2));
    expect(y.get('b')!.toFixed(2)).toBe(x.get('b')!.toFixed(2));
  });

  it('รับทีละครั้งได้ต้นทุนชุดเดียวกับรับครั้งเดียว (หน่วยลำดับที่ k ของรายการได้ต้นทุนตัวเดิมเสมอ)', () => {
    const lineCost = D('9999.98');
    const oneShot = poUnitCosts(lineCost, 3, 1, 3).map((c) => c.toFixed(2));
    const split = [...poUnitCosts(lineCost, 3, 1, 2), ...poUnitCosts(lineCost, 3, 3, 1)].map((c) => c.toFixed(2));
    expect(split).toEqual(oneShot);
    expect(poUnitCostAt(lineCost, 3, 2).toFixed(2)).toBe('3333.32');
  });

  it('ยอดรวมราคาเป็นศูนย์ทั้งใบ → ทุกหน่วยต้นทุนศูนย์', () => {
    expect(allUnitCosts('0', lines(['a', 2, '0']))).toEqual([['0.00', '0.00']]);
  });

  it('ยอดสุทธิเป็นศูนย์ (ส่วนลดเต็มมูลค่า) → ทุกหน่วยต้นทุนศูนย์', () => {
    expect(allUnitCosts('0', lines(['a', 2, '500']))).toEqual([['0.00', '0.00']]);
  });

  it('คืน Prisma.Decimal', () => {
    const byLine = poLineCosts({ netAmount: new Prisma.Decimal('10700'), lines: lines(['a', 1, '10000']) });
    expect(byLine.get('a')).toBeInstanceOf(Prisma.Decimal);
    expect(poUnitCostAt(byLine.get('a')!, 1, 1)).toBeInstanceOf(Prisma.Decimal);
  });

  it('ยอดสุทธิติดลบ → RangeError (ผู้เรียกต้องดักก่อนและแจ้งผู้ใช้เป็นภาษาไทย)', () => {
    expect(() => poLineCosts({ netAmount: '-50', lines: lines(['a', 1, '1000']) })).toThrow(RangeError);
  });

  it('ลำดับหน่วยนอกช่วง 1..จำนวนที่สั่ง → RangeError', () => {
    expect(() => poUnitCostAt(D('100'), 2, 0)).toThrow(RangeError);
    expect(() => poUnitCostAt(D('100'), 2, 3)).toThrow(RangeError);
  });
});
