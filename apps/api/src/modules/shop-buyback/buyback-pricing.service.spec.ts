import { Prisma } from '@prisma/client';
import { BuybackPricingService, DeductSelection } from './buyback-pricing.service';

const D = (n: number | string) => new Prisma.Decimal(n);
const sel = (
  deductType: 'PERCENT' | 'FIXED',
  deductValue: number,
  label = 'x',
): DeductSelection => ({ choiceId: 'c-' + label, label, deductType, deductValue: D(deductValue) });

describe('BuybackPricingService', () => {
  const svc = new BuybackPricingService();

  it('สภาพสมบูรณ์ (ไม่มีหัก) = maxPrice เต็ม', () => {
    const r = svc.compute(D(14500), []);
    expect(r.price.toNumber()).toBe(14500);
    expect(r.fixedTotal.toNumber()).toBe(0);
    expect(r.pctTotal.toNumber()).toBe(0);
  });

  it('golden yellobe: max 14,500 / หมดประกัน 500 + ไม่มีกล่อง 500 + รอยนิดหน่อย 8% → 12,420', () => {
    const r = svc.compute(D(14500), [
      sel('FIXED', 500, 'หมดประกัน'),
      sel('FIXED', 500, 'ไม่มีกล่อง'),
      sel('PERCENT', 8, 'รอยนิดหน่อย'),
    ]);
    expect(r.price.toNumber()).toBe(12420);
    expect(r.fixedTotal.toNumber()).toBe(1000);
    expect(r.pctTotal.toNumber()).toBe(8);
  });

  it('seed จริง: max 20,000 / fixed 1,000 / pct 8 → 17,480', () => {
    const r = svc.compute(D(20000), [sel('FIXED', 1000), sel('PERCENT', 8)]);
    expect(r.price.toNumber()).toBe(17480);
  });

  it('ปัดลงเหลือหลักสิบ', () => {
    // (9999 - 0) * 1 = 9999 → 9990
    expect(svc.compute(D(9999), []).price.toNumber()).toBe(9990);
  });

  it('Σ% เกิน 100 → clamp ที่ 100 → ราคา 0', () => {
    const r = svc.compute(D(14500), [sel('PERCENT', 75), sel('PERCENT', 85)]);
    expect(r.pctTotal.toNumber()).toBe(100);
    expect(r.price.toNumber()).toBe(0);
  });

  it('fixed เกิน maxPrice → ราคา 0 ไม่ติดลบ', () => {
    expect(svc.compute(D(1000), [sel('FIXED', 1500)]).price.toNumber()).toBe(0);
  });

  it('lines: PERCENT คิดจากยอดหลังหัก fixed', () => {
    const r = svc.compute(D(14500), [sel('FIXED', 1000), sel('PERCENT', 8, 'scratch')]);
    const pctLine = r.lines.find((l) => l.label === 'scratch')!;
    expect(pctLine.amount).toBe('1080.00'); // (14500-1000)*8%
  });

  it.each([
    [0, 'A'],
    [8, 'B'],
    [10, 'B'],
    [18, 'C'],
    [35, 'C'],
    [51, 'D'],
  ])('gradeFromPct(%d) = %s', (pct, grade) => {
    expect(svc.gradeFromPct(D(pct))).toBe(grade);
  });

  describe('applyExchangeBonus', () => {
    it('golden: 12,420 @10% → 13,660 (13,662 ปัดลงหลักสิบ)', () => {
      expect(svc.applyExchangeBonus(D(12420), D(10)).toNumber()).toBe(13660);
    });

    it('@0% → เท่าราคาเงินสด', () => {
      expect(svc.applyExchangeBonus(D(12420), D(0)).toNumber()).toBe(12420);
    });

    it('ปัดลงหลักสิบเสมอ', () => {
      // 9995 × 1.1 = 10994.5 → 10990
      expect(svc.applyExchangeBonus(D(9995), D(10)).toNumber()).toBe(10990);
    });

    it('cash 0 → 0', () => {
      expect(svc.applyExchangeBonus(D(0), D(10)).toNumber()).toBe(0);
    });
  });
});
