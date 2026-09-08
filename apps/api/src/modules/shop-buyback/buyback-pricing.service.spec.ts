import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BuybackPricingService, DeductSelection } from './buyback-pricing.service';

const D = (n: number | string) => new Prisma.Decimal(n);
const sel = (
  deductType: 'PERCENT' | 'FIXED',
  deductValue: number,
  label = 'x',
): DeductSelection => ({ choiceId: 'c-' + label, label, deductType, deductValue: D(deductValue) });

const captured = JSON.parse(readFileSync(resolve(__dirname, '../../../../../docs/reference/yellobe-2026-09-08/pricing-observations.json'), 'utf8')) as {
  observations: Array<{ name: string; basePrice: string; resultPrice: string;
    selected: Array<{ inputId: string; label: string; deductType: 'FIXED' | 'PERCENT' | null; deductValue: string | null }> }>;
};

describe('BuybackPricingService', () => {
  const svc = new BuybackPricingService();

  it('keeps all 13 captured anonymous source observations in the parity fixture', () => {
    expect(captured.observations).toHaveLength(13);
  });

  it.each(captured.observations)('matches captured reference result: $name', (observation) => {
    const selections = observation.selected.flatMap((choice) => choice.deductType && choice.deductValue !== null
      ? [{ choiceId: choice.inputId, label: choice.label, deductType: choice.deductType, deductValue: D(choice.deductValue) }] : []);
    const result = svc.compute(D(observation.basePrice), selections, 'MAX_PERCENT_EXACT');
    expect(result.price.toFixed(2)).toBe(D(observation.resultPrice).toFixed(2));
    expect(result.lines.reduce((sum, line) => sum.plus(line.amount), D(0)).toFixed(2))
      .toBe(D(observation.basePrice).minus(result.price).toFixed(2));
  });

  it('applies BESTCHOICE zero floor and cent precision safeguards separately from source parity', () => {
    const clamped = svc.compute(D(100), [sel('FIXED', 150), sel('PERCENT', 15)], 'MAX_PERCENT_EXACT');
    expect(clamped.price.toString()).toBe('0');
    expect(clamped.lines.map((line) => line.amount)).toEqual(['100.00', '0.00']);
    expect(svc.compute(D('100.01'), [sel('PERCENT', 33.33)], 'MAX_PERCENT_EXACT').price.toFixed(2)).toBe('66.68');
  });

  it('reference mode uses the highest percentage after fixed deductions without rounding to tens', () => {
    const mode = 'MAX_PERCENT_EXACT' as const;
    expect(svc.compute(D(5000), [sel('FIXED', 500), sel('PERCENT', 15)], mode).price.toString()).toBe('3825');
    const equalPercent = svc.compute(D(5000), [sel('PERCENT', 15, 'body'), sel('PERCENT', 15, 'screen')], mode);
    expect(equalPercent.price.toString()).toBe('4250');
    expect(equalPercent.lines.map((line) => line.amount)).toEqual(['750.00', '0.00']);
    const display = svc.compute(D(5000), [sel('PERCENT', 15, 'body'), sel('PERCENT', 45, 'display')], mode);
    expect(display.price.toString()).toBe('2750');
    expect(display.pctTotal.toString()).toBe('45');
    expect(display.lines.map((line) => line.amount)).toEqual(['0.00', '2250.00']);
  });

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
