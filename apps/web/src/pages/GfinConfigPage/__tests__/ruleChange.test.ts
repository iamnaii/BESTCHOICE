import { describe, expect, it } from 'vitest';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { buildModelTermsView } from '../terms/modelTerms';
import {
  describeEdit,
  needsValues,
  previewExample,
  summarizeCurrent,
  toBulkUpsertBody,
  validateEdit,
  type RuleEdit,
} from '../terms/ruleChange';

const settings = {
  minDownPct: 25,
  maxDownPct: 80,
  downStepPct: 5,
  contractFee: 100,
  commissionPctByCategory: { PHONE: 15, TABLET: 5 },
};
const tables: GfinTables = {
  mappings: [
    { id: 'm1', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '38900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: true },
    { id: 'm2', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '512GB', condition: 'HAND_2', maxPrice: '41900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: true },
    { id: 'm3', gfinSeries: 'iPhone 17', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '25000', modelMatchPattern: 'iPhone 17', isActive: true },
    { id: 'm4', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  rules: [
    { id: 'r1', label: 'iPhone 17 Pro Max มือ 2', seriesPattern: 'iPhone 17 Pro Max', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
    { id: 'r2', label: 'iPhone 17 มือ 2', seriesPattern: 'iPhone 17', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
  ],
  factors: [
    { id: 'f10', months: 10, shopCommissionPct: 15, factor: '0.1286', feePerInstallment: '100', isActive: true },
    { id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.1105', feePerInstallment: '100', isActive: true },
    { id: 'f15', months: 15, shopCommissionPct: 15, factor: '0.0921', feePerInstallment: '100', isActive: true },
  ],
  settings,
};
const view = buildModelTermsView(tables);
const row = (key: string) => view.rows.find((r) => r.key === key)!;
const pm = row('iPhone 17 Pro Max|HAND_2');
const base = row('iPhone 17|HAND_2');
const noRule = row('iPhone 12|HAND_2');
const KEEP: RuleEdit = { allowance: { mode: 'keep' }, maxMonths: { mode: 'keep' }, down: { mode: 'keep' } };

describe('summarizeCurrent', () => {
  it('ค่าเดียวกันทุกแถว → "ตอนนี้ X ทั้ง N รุ่น"', () => {
    expect(summarizeCurrent([pm, base])).toEqual({
      allowance: 'ตอนนี้ +2,000 ทั้ง 2 รุ่น',
      maxMonths: 'ตอนนี้ 15 งวด ทั้ง 2 รุ่น',
      down: 'ตอนนี้ 30% (ตั้งเฉพาะรุ่น) ทั้ง 2 รุ่น',
    });
  });
  it('ต่างกัน → "ตอนนี้ต่างกัน N ค่า" · แถวเดียว ไม่มีคำว่า ทั้ง', () => {
    expect(summarizeCurrent([pm, noRule]).allowance).toBe('ตอนนี้ต่างกัน 2 ค่า');
    expect(summarizeCurrent([noRule]).down).toBe('ตอนนี้ 25% (ค่ากลาง)');
  });
});

describe('validateEdit / toBulkUpsertBody', () => {
  it('แถวที่ยังไม่ตั้งเงื่อนไขต้องกรอก OVER และผ่อนสูงสุด', () => {
    expect(needsValues([pm, noRule])).toBe(true);
    expect(validateEdit([noRule], { ...KEEP, down: { mode: 'default' } })).toBe(
      'มีแถวที่ยังไม่ตั้งเงื่อนไข — ต้องกรอก OVER',
    );
    expect(validateEdit([noRule], { ...KEEP, allowance: { mode: 'set', value: 0 } })).toBe(
      'มีแถวที่ยังไม่ตั้งเงื่อนไข — ต้องเลือกผ่อนสูงสุด',
    );
  });
  it('ไม่เปลี่ยนอะไรเลย = บันทึกไม่ได้ · ค่าผิดช่วง = บอกเหตุ', () => {
    expect(validateEdit([pm], KEEP)).toBe('ยังไม่ได้เปลี่ยนอะไร');
    expect(validateEdit([pm], { ...KEEP, allowance: { mode: 'set', value: -1 } })).toBe('OVER ต้องเป็น 0 ขึ้นไป');
    expect(validateEdit([pm], { ...KEEP, down: { mode: 'set', value: 90 } })).toBe('ดาวน์ต้องอยู่ระหว่าง 0–80%');
  });
  it('body: ฟิลด์ "ไม่เปลี่ยน" ไม่ส่ง · ค่ากลาง = minDownPct null', () => {
    expect(toBulkUpsertBody([pm, base], { ...KEEP, down: { mode: 'default' } })).toEqual({
      items: [
        { series: 'iPhone 17 Pro Max', condition: 'HAND_2' },
        { series: 'iPhone 17', condition: 'HAND_2' },
      ],
      minDownPct: null,
    });
    expect(
      toBulkUpsertBody([noRule], { allowance: { mode: 'set', value: 0 }, maxMonths: { mode: 'set', value: 12 }, down: { mode: 'set', value: 30 } }),
    ).toEqual({ items: [{ series: 'iPhone 12', condition: 'HAND_2' }], allowance: 0, maxMonths: 12, minDownPct: 30 });
  });
});

describe('describeEdit / previewExample', () => {
  it('สรุป "จะเปลี่ยน"', () => {
    expect(describeEdit([pm, base], { allowance: { mode: 'set', value: 1500 }, maxMonths: { mode: 'keep' }, down: { mode: 'default' } }, 25)).toEqual([
      'OVER +2,000 → +1,500',
      'ดาวน์ 30% (ตั้งเฉพาะรุ่น) → 25% (ค่ากลาง)',
    ]);
  });
  it('ตัวอย่างเครื่องแรก (ความจุต่ำสุด · ขายเท่าราคาส่ง): ดาวน์ 30% → 25%', () => {
    const p = previewExample(tables, [pm, base], { ...KEEP, down: { mode: 'default' } });
    expect(p).toEqual({
      label: 'iPhone 17 Pro Max 256GB มือ 2',
      before: { salePrice: 40900, down: 12300, monthly: 2737, months: 15 },
      after: { salePrice: 40900, down: 10300, monthly: 2926, months: 15 },
    });
  });
});
