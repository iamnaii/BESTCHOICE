import { describe, expect, it } from 'vitest';
import type { GfinTables, MaxPriceApi, OverpriceApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import {
  ALL_FAMILIES,
  buildModelTermsView,
  familyOf,
  filterFamilies,
  selectionSummary,
  storageGb,
} from '../terms/modelTerms';

const settings = {
  minDownPct: 25,
  maxDownPct: 80,
  downStepPct: 5,
  contractFee: 100,
  commissionPctByCategory: { PHONE: 15, TABLET: 5 },
};
const price = (
  id: string,
  series: string,
  storage: string,
  condition: 'HAND_1' | 'HAND_2',
  maxPrice: number,
  isActive = true,
  gfinVariant: string | null = null,
): MaxPriceApi => ({
  id, gfinSeries: series, gfinVariant, storage, condition, maxPrice: String(maxPrice), modelMatchPattern: series, isActive,
});
const rule = (
  id: string,
  series: string,
  condition: 'HAND_1' | 'HAND_2',
  allowance: number,
  maxMonths: number | null,
  minDownPct: number | null = null,
  isActive = true,
): OverpriceApi => ({
  id, label: series, seriesPattern: series, condition, allowance: String(allowance), maxMonths, minDownPct, isActive,
});
const tables = (mappings: MaxPriceApi[], rules: OverpriceApi[]): GfinTables => ({ mappings, rules, factors: [], settings });

describe('buildModelTermsView', () => {
  it('คอลัมน์ความจุสร้างจากข้อมูล เรียง 64GB → 1TB', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('a', 'iPhone 15', '1TB', 'HAND_1', 40000),
          price('b', 'iPhone 15', '128 GB', 'HAND_1', 20000),
          price('c', 'iPhone 12', '64GB', 'HAND_2', 9000),
        ],
        [],
      ),
    );
    expect(view.storageColumns).toEqual(['64GB', '128GB', '1TB']);
  });

  it('แถวมือ N ขึ้นเฉพาะเมื่อมีราคาของมือนั้น (เปิดหรือปิด) · แถวรูปแบบเก่าที่มีรุ่นย่อยไม่ขึ้น', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('a', 'iPhone 12', '64GB', 'HAND_2', 9000),
          price('b', 'iPhone 13', '128GB', 'HAND_1', 15000, false),
          price('c', 'iPhone 14', '128GB', 'HAND_1', 18000, true, 'Pro'),
        ],
        [],
      ),
    );
    expect(view.rows.map((r) => r.key)).toEqual(['iPhone 12|HAND_2', 'iPhone 13|HAND_1']);
  });

  it('ช่องราคา: เปิด = ตัวเลข · ปิด = null แต่มี mappingId · ไม่มีแถว = mappingId null', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('open', 'iPhone 15', '128GB', 'HAND_1', 20000),
          price('closed', 'iPhone 15', '256GB', 'HAND_1', 24000, false),
          price('other', 'iPhone 16', '512GB', 'HAND_1', 30000),
        ],
        [],
      ),
    );
    const row = view.rows.find((r) => r.key === 'iPhone 15|HAND_1')!;
    expect(row.cells).toEqual([
      { storage: '128GB', mappingId: 'open', price: 20000 },
      { storage: '256GB', mappingId: 'closed', price: null },
      { storage: '512GB', mappingId: null, price: null },
    ]);
  });

  it('ดาวน์: กติกาตั้ง = MODEL · ไม่ตั้ง = ค่ากลาง · กติกาที่ปิดใช้ไม่นับ (ต้องตั้ง)', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('a', 'iPhone 17', '256GB', 'HAND_1', 30000),
          price('b', 'iPhone 17', '256GB', 'HAND_2', 25000),
          price('c', 'iPhone 16', '128GB', 'HAND_2', 20000),
          price('d', 'iPhone 12', '64GB', 'HAND_2', 9000, false),
        ],
        [
          rule('r1', 'iPhone 17', 'HAND_1', 2000, 15, 30),
          rule('r2', 'iPhone 17', 'HAND_2', 2000, 15, null),
          rule('r3', 'iPhone 16', 'HAND_2', 1000, 12, null, false),
        ],
      ),
    );
    const byKey = Object.fromEntries(view.rows.map((r) => [r.key, r]));
    expect(byKey['iPhone 17|HAND_1']).toMatchObject({ downPct: 30, downSource: 'MODEL', allowance: 2000, maxMonths: 15, needsRule: false });
    expect(byKey['iPhone 17|HAND_2']).toMatchObject({ downPct: 25, downSource: 'DEFAULT' });
    expect(byKey['iPhone 16|HAND_2']).toMatchObject({ rule: null, needsRule: true, hasActivePrice: true });
    expect(byKey['iPhone 12|HAND_2']).toMatchObject({ rule: null, needsRule: false, hasActivePrice: false });
    expect(view.needsRuleRows.map((r) => r.key)).toEqual(['iPhone 16|HAND_2']);
  });

  it('ตระกูลเรียง 12 … 17, Air, 18 · รุ่นในตระกูลเรียง ปกติ → e → Plus → Pro → Pro Max · มือ 1 ก่อนมือ 2', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('1', 'iPhone 18 Pro', '256GB', 'HAND_1', 1),
          price('2', 'iPhone Air', '256GB', 'HAND_1', 1),
          price('3', 'iPhone 17 Pro Max', '256GB', 'HAND_2', 1),
          price('4', 'iPhone 17 Pro Max', '256GB', 'HAND_1', 1),
          price('5', 'iPhone 17e', '256GB', 'HAND_1', 1),
          price('6', 'iPhone 17', '256GB', 'HAND_1', 1),
          price('7', 'iPhone 12', '64GB', 'HAND_2', 1),
        ],
        [],
      ),
    );
    expect(view.families.map((f) => f.label)).toEqual(['iPhone 12', 'iPhone 17', 'iPhone Air', 'iPhone 18']);
    expect(view.families[1].rows.map((r) => r.key)).toEqual([
      'iPhone 17|HAND_1',
      'iPhone 17e|HAND_1',
      'iPhone 17 Pro Max|HAND_1',
      'iPhone 17 Pro Max|HAND_2',
    ]);
  });
});

describe('helpers', () => {
  it('familyOf / storageGb', () => {
    expect(familyOf('iPhone 16e')).toBe('16');
    expect(familyOf('iPhone 17 Pro Max')).toBe('17');
    expect(familyOf('iPhone Air')).toBe('Air');
    expect(storageGb('1 TB')).toBe(1024);
    expect(storageGb('64GB')).toBe(64);
  });

  it('filterFamilies: ค้นหา · ตระกูล · มือ · เฉพาะแถวที่ต้องดู', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('a', 'iPhone 12', '64GB', 'HAND_2', 9000),
          price('b', 'iPhone 17 Pro', '256GB', 'HAND_1', 30000),
          price('c', 'iPhone 17 Pro', '256GB', 'HAND_2', 25000),
        ],
        [rule('r', 'iPhone 17 Pro', 'HAND_1', 2000, 15), rule('s', 'iPhone 17 Pro', 'HAND_2', 2000, 15)],
      ),
    );
    const keys = (f: Parameters<typeof filterFamilies>[1]) =>
      filterFamilies(view, f).flatMap((fam) => fam.rows.map((r) => r.key));
    const base = { search: '', family: ALL_FAMILIES, hand: 'ALL' as const, onlyAttention: false };
    expect(keys(base)).toHaveLength(3);
    expect(keys({ ...base, search: 'pro' })).toEqual(['iPhone 17 Pro|HAND_1', 'iPhone 17 Pro|HAND_2']);
    expect(keys({ ...base, family: '12' })).toEqual(['iPhone 12|HAND_2']);
    expect(keys({ ...base, hand: 'HAND_1' })).toEqual(['iPhone 17 Pro|HAND_1']);
    expect(keys({ ...base, onlyAttention: true })).toEqual(['iPhone 12|HAND_2']);
  });

  it('selectionSummary', () => {
    const view = buildModelTermsView(
      tables([price('a', 'iPhone 17', '256GB', 'HAND_1', 1), price('b', 'iPhone 17', '256GB', 'HAND_2', 1)], []),
    );
    expect(selectionSummary([view.rows[1]])).toBe('เลือก 1 แถว · มือ 2');
    expect(selectionSummary(view.rows)).toBe('เลือก 2 แถว · มือ 1 และมือ 2');
  });
});
