import { describe, expect, it, vi } from 'vitest';
import { ImportBatchError } from '@/utils/excel-cell.util';
import type { OverpriceApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import type { ExistingMaxPrice } from '../gfinPriceListImport';
import {
  buildImportTermsReview,
  buildRuleUpsertBatches,
  closeIdsFor,
  findMissingPrices,
  missingLines,
  resolveTermsPlan,
  ruleChangeText,
  runGfinImport,
} from '../import/gfinImportTerms';

const row = (model: string, storage: string, hand: string, price: number, over?: unknown, months?: unknown) => ({
  'รุ่น': model,
  'ความจุ': storage,
  'มือ 1/มือ 2': hand,
  'ราคา': price,
  ...(over !== undefined ? { OVER: over } : {}),
  ...(months !== undefined ? { 'ผ่อนสูงสุด': months } : {}),
});
const ex = (id: string, series: string, storage: string, condition: 'HAND_1' | 'HAND_2', maxPrice: number, isActive = true): ExistingMaxPrice => ({
  id, gfinSeries: series, gfinVariant: null, storage, condition, maxPrice: String(maxPrice), modelMatchPattern: series, isActive,
});
const rule = (series: string, condition: 'HAND_1' | 'HAND_2', allowance: number, maxMonths: number | null, isActive = true): OverpriceApi => ({
  id: `${series}-${condition}`, label: series, seriesPattern: series, condition, allowance: String(allowance), maxMonths, minDownPct: null, isActive,
});

describe('findMissingPrices', () => {
  const existing = [
    ex('a', 'iPhone 14 Pro', '128GB', 'HAND_2', 20000),
    ex('b', 'iPhone 14 Pro', '1TB', 'HAND_2', 28000),
    ex('c', 'iPhone 12', '64GB', 'HAND_2', 9000),
    ex('d', 'iPhone 12', '128GB', 'HAND_2', 10000),
    ex('e', 'iPhone 11', '64GB', 'HAND_2', 7000, false),
  ];
  const rows = [row('iPhone 14 Pro', '128GB', 'มือ 2', 20000)];

  it('รุ่นที่มีในไฟล์แต่ขาดบางช่อง = partial · รุ่นที่ไม่มีในไฟล์เลย = absent · ราคาที่ปิดอยู่ไม่นับ', () => {
    const m = findMissingPrices(rows, existing);
    expect(m.partial.map((x) => x.id)).toEqual(['b']);
    expect(m.absent.map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('ค่าตั้งต้น: ปิด partial · เปิด absent ไว้ (ไฟล์ 2 แถวไม่ปิดราคาอื่นถ้าไม่ติ๊ก)', () => {
    const m = findMissingPrices(rows, existing);
    expect(closeIdsFor(m, { closePartial: true, closeAbsent: false })).toEqual(['b']);
    expect(closeIdsFor(m, { closePartial: true, closeAbsent: true })).toEqual(['b', 'c', 'd']);
  });

  it('missingLines รวมตามรุ่น·มือ', () => {
    expect(missingLines(findMissingPrices(rows, existing).absent)).toEqual(['iPhone 12 · มือ 2 · 64GB 9,000 · 128GB 10,000']);
  });
});

describe('buildImportTermsReview', () => {
  const existing = [ex('a', 'iPhone 14 Pro', '128GB', 'HAND_2', 20000)];

  it('OVER ต่างกันตามความจุ → CHOOSE (ค่าที่ใช้มากสุดก่อน)', () => {
    const review = buildImportTermsReview(
      [
        row('iPhone 14 Pro', '128GB', 'มือ 2', 20000, 2000, 15),
        row('iPhone 14 Pro', '256GB', 'มือ 2', 22000, 2000, 15),
        row('iPhone 14 Pro', '1TB', 'มือ 2', 28000, 0, 15),
      ],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15)],
    );
    expect(review.hasTermColumns).toBe(true);
    const pair = review.pairs[0];
    expect(pair.status).toBe('CHOOSE');
    expect(pair.allowance).toEqual({
      kind: 'choose',
      options: [
        { value: 2000, storages: ['128GB', '256GB'] },
        { value: 0, storages: ['1TB'] },
      ],
    });
    expect(pair.maxMonths).toEqual({ kind: 'value', value: 15 });
  });

  it('ตรงกับระบบ = MATCH · ต่าง = CHANGE · ชื่อรุ่นตามระบบแม้ไฟล์พิมพ์ตัวเล็ก', () => {
    const review = buildImportTermsReview(
      [row('iphone 14 pro', '128GB', 'มือ 2', 20000, 2000, 12), row('iPhone 15', '128GB', 'มือ 1', 25000, 1000, 15)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15), rule('iPhone 15', 'HAND_1', 1000, 15)],
    );
    const byKey = Object.fromEntries(review.pairs.map((p) => [p.key, p.status]));
    expect(byKey).toEqual({ 'iPhone 14 Pro|HAND_2': 'CHANGE', 'iPhone 15|HAND_1': 'MATCH' });
  });

  it('ไฟล์ไม่มีคอลัมน์เงื่อนไข → hasTermColumns false · คู่เดิมไม่เปลี่ยน · คู่ใหม่ต้องกรอก', () => {
    const review = buildImportTermsReview(
      [row('iPhone 14 Pro', '128GB', 'มือ 2', 20000), row('iPhone 18 Pro', '256GB', 'มือ 2', 45000)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15)],
    );
    expect(review.hasTermColumns).toBe(false);
    const plan = resolveTermsPlan(review, {});
    expect(plan.changes).toEqual([]);
    expect(plan.missing).toEqual(['iPhone 18 Pro|HAND_2']);
    const filled = resolveTermsPlan(review, { 'iPhone 18 Pro|HAND_2': { allowance: 2000, maxMonths: 15 } });
    expect(filled).toEqual({
      changes: [{ series: 'iPhone 18 Pro', condition: 'HAND_2', allowance: 2000, maxMonths: 15 }],
      missing: [],
    });
  });

  it('ค่าที่เลือกไม่ถูกต้อง (NaN/ติดลบ/ทศนิยมเกิน/งวดนอก 1–36): คู่ใหม่ = ยังขาด · คู่เดิม = ไม่สนใจ', () => {
    const review = buildImportTermsReview(
      [row('iPhone 18 Pro', '256GB', 'มือ 2', 45000), row('iPhone 14 Pro', '128GB', 'มือ 2', 20000)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15, true)],
    );
    const k = 'iPhone 18 Pro|HAND_2';
    for (const bad of [NaN, -5, 1.234, Infinity]) {
      expect(resolveTermsPlan(review, { [k]: { allowance: bad, maxMonths: 15 } }).missing).toEqual([k]);
    }
    for (const bad of [0, 37, 1.5, NaN]) {
      expect(resolveTermsPlan(review, { [k]: { allowance: 2000, maxMonths: bad } }).missing).toEqual([k]);
    }
    const old = 'iPhone 14 Pro|HAND_2';
    const plan = resolveTermsPlan(review, { [old]: { allowance: NaN, maxMonths: 99 }, [k]: { allowance: 0, maxMonths: 12 } });
    expect(plan.changes).toEqual([{ series: 'iPhone 18 Pro', condition: 'HAND_2', allowance: 0, maxMonths: 12 }]);
  });

  it('กติกาที่ปิดใช้ = ยังไม่มีเงื่อนไข (NEW) · ค่าในไฟล์ผิดรูป = คำเตือน ไม่ใช้ค่านั้น', () => {
    const review = buildImportTermsReview(
      [row('iPhone 14 Pro', '128GB', 'มือ 2', 20000, 'abc', 15)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15, false)],
    );
    expect(review.pairs[0].status).toBe('NEW');
    expect(review.warnings).toEqual(['แถว 2: OVER "abc" ไม่ใช่ตัวเลขตั้งแต่ 0 ขึ้นไป — ไม่ใช้ค่านี้']);
    expect(resolveTermsPlan(review, {}).missing).toEqual(['iPhone 14 Pro|HAND_2']);
  });

  it('แถวที่หน้าตรวจราคาข้าม (ทศนิยมเกิน 2 ตำแหน่ง) ไม่ทำให้เกิดคู่เงื่อนไข · แถวซ้ำที่ถูกต้องภายหลังใช้แทน', () => {
    const only = buildImportTermsReview([row('iPhone 18', '128GB', 'มือ 1', 12900.123, 500, 12)], existing, []);
    expect(only.pairs).toEqual([]);
    const mixed = buildImportTermsReview(
      [row('iPhone 18', '128GB', 'มือ 1', 12900.123, 500, 12), row('iPhone 18', '128GB', 'มือ 1', 12900, 700, 15)],
      existing,
      [],
    );
    expect(mixed.pairs).toHaveLength(1);
    expect(mixed.pairs[0].allowance).toEqual({ kind: 'value', value: 700 });
    expect(mixed.pairs[0].maxMonths).toEqual({ kind: 'value', value: 15 });
  });

  it('ชื่อรุ่นต่างตัวพิมพ์ในไฟล์เดียวกัน = คู่เดียว ใช้การสะกดของแถวแรก', () => {
    const review = buildImportTermsReview(
      [row('iPhone 18 Pro', '128GB', 'มือ 1', 40000, 1000, 12), row('iphone 18 pro', '256GB', 'มือ 1', 45000, 1000, 12)],
      existing,
      [],
    );
    expect(review.pairs).toHaveLength(1);
    expect(review.pairs[0].series).toBe('iPhone 18 Pro');
    expect(review.pairs[0].status).toBe('NEW');
  });

  it('OVER 0 เป็นค่าจริง · คู่ใหม่ที่มีแค่ OVER อยู่ใน missing · คำเตือนเฉพาะแถวที่ใช้จริง', () => {
    const zero = buildImportTermsReview([row('iPhone 18', '128GB', 'มือ 1', 40000, 0, 12)], existing, []);
    expect(resolveTermsPlan(zero, {}).changes).toEqual([
      { series: 'iPhone 18', condition: 'HAND_1', allowance: 0, maxMonths: 12 },
    ]);
    const overOnly = buildImportTermsReview([row('iPhone 18', '128GB', 'มือ 1', 40000, 500)], existing, []);
    expect(resolveTermsPlan(overOnly, {}).missing).toEqual(['iPhone 18|HAND_1']);
    const warn = buildImportTermsReview(
      [row('iPhone 18', '128GB', 'มือ 1', 40000, 500, 12), row('iPhone 18', '128GB', 'มือ 1', 40000, 'abc', 99)],
      existing,
      [],
    );
    expect(warn.warnings).toEqual([]);
  });

  it('resolveTermsPlan: CHOOSE ใช้ค่าแรกถ้าไม่เลือก · ส่งเฉพาะฟิลด์ที่ต่างจากระบบ · ruleChangeText', () => {
    const review = buildImportTermsReview(
      [row('iPhone 14 Pro', '128GB', 'มือ 2', 20000, 2000, 12), row('iPhone 14 Pro', '1TB', 'มือ 2', 28000, 0, 12)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15)],
    );
    expect(resolveTermsPlan(review, {}).changes).toEqual([{ series: 'iPhone 14 Pro', condition: 'HAND_2', maxMonths: 12 }]);
    const chosen = resolveTermsPlan(review, { 'iPhone 14 Pro|HAND_2': { allowance: 0 } });
    expect(chosen.changes).toEqual([{ series: 'iPhone 14 Pro', condition: 'HAND_2', allowance: 0, maxMonths: 12 }]);
    expect(ruleChangeText(chosen.changes[0], review.pairs[0])).toBe('iPhone 14 Pro มือ 2: OVER +2,000 → +0 · ผ่อนสูงสุด 15 → 12 งวด');
  });
});

describe('buildRuleUpsertBatches', () => {
  it('รวมคู่ที่ค่าเหมือนกันเป็นคำขอเดียว', () => {
    expect(
      buildRuleUpsertBatches([
        { series: 'A', condition: 'HAND_1', allowance: 2000, maxMonths: 15 },
        { series: 'B', condition: 'HAND_2', maxMonths: 12 },
        { series: 'C', condition: 'HAND_1', allowance: 2000, maxMonths: 15 },
      ]),
    ).toEqual([
      { items: [{ series: 'A', condition: 'HAND_1' }, { series: 'C', condition: 'HAND_1' }], allowance: 2000, maxMonths: 15 },
      { items: [{ series: 'B', condition: 'HAND_2' }], maxMonths: 12 },
    ]);
  });
});

describe('runGfinImport', () => {
  const items = Array.from({ length: 150 }, (_, i) => ({ model: `M${i}`, storage: '128GB', condition: 'HAND_1' as const, maxPrice: 1000 }));

  it('ลำดับ ราคา(ชุดละ 100) → ปิด → เงื่อนไข · แจ้งความคืบหน้าทุกชุด', async () => {
    const calls: string[] = [];
    const sender = {
      importPrices: vi.fn(async (b: { items: unknown[] }) => (calls.push(`price:${b.items.length}`), { created: b.items.length, updated: 0, unchanged: 0 })),
      closePrices: vi.fn(async (ids: string[]) => (calls.push(`close:${ids.length}`), { closed: ids.length })),
      upsertRules: vi.fn(async (b: { items: unknown[] }) => (calls.push(`rules:${b.items.length}`), {})),
    };
    const progress: string[] = [];
    const out = await runGfinImport(
      sender,
      { prices: items, closeIds: ['x', 'y'], ruleBatches: [{ items: [{ series: 'A', condition: 'HAND_1' }], maxMonths: 12 }] },
      (d, t) => progress.push(`${d}/${t}`),
    );
    expect(calls).toEqual(['price:100', 'price:50', 'close:2', 'rules:1']);
    expect(progress).toEqual(['0/4', '1/4', '2/4', '3/4', '4/4']);
    expect(out).toEqual({ prices: { created: 150, updated: 0, unchanged: 0 }, closed: 2, rulesSaved: 1 });
  });

  it('พลาดกลางทาง → บอกว่าบันทึกไปแล้วกี่ชุด + นำเข้าไฟล์เดิมซ้ำได้', async () => {
    const sender = {
      importPrices: vi.fn(async () => ({ created: 1, updated: 0, unchanged: 0 })),
      closePrices: vi.fn(async () => {
        throw new Error('boom');
      }),
      upsertRules: vi.fn(),
    };
    await expect(runGfinImport(sender, { prices: items.slice(0, 1), closeIds: ['x'], ruleBatches: [] })).rejects.toEqual(
      new ImportBatchError('ชุดที่ 2/2 ส่งไม่สำเร็จ (boom) — บันทึกแล้ว 1/2 ชุด · นำเข้าไฟล์เดิมซ้ำได้ ชุดที่บันทึกแล้วจะนับเป็น "เท่าเดิม"'),
    );
    expect(sender.upsertRules).not.toHaveBeenCalled();
  });
});
