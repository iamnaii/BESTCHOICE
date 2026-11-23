import { describe, expect, it } from 'vitest';
import { calcTables } from './fixtures/calcTables';
import { gfinProductOf, gfinQuoteAt } from '../gfinQuoteAt';
import { buildCalcLines, calcSeriesOptions, unavailableText } from '../calc/calcModel';

const input = { series: 'iPhone 17 Pro Max', storage: '256GB', condition: 'HAND_2' as const, deviceOrigin: 'THAI' as const };
const product = gfinProductOf(input.series, input.storage, input.condition, input.deviceOrigin);

describe('calcSeriesOptions', () => {
  it('เฉพาะความจุที่มีราคาเปิดอยู่ แยกตามมือ', () => {
    expect(calcSeriesOptions(calcTables)).toEqual([
      { series: 'iPhone 12', hands: { HAND_2: ['64GB'] } },
      { series: 'iPhone 17 Pro Max', hands: { HAND_2: ['256GB'] } },
    ]);
  });
});

describe('buildCalcLines', () => {
  it('ขายเท่าราคาส่ง: ทุกบรรทัดบอกที่มา', () => {
    const lines = buildCalcLines(input, gfinQuoteAt(calcTables, product, null), calcTables.settings.minDownPct);
    expect(lines.map((l) => [l.label, l.amount])).toEqual([
      ['ราคาสูงสุดในใบราคา', 38900],
      ['+ OVER', 2000],
      ['= ราคาส่ง GFIN', 40900],
      ['ดาวน์ขั้นต่ำ 30% ของราคาส่ง', 12270],
      ['= ดาวน์ลูกค้า (ปัดขึ้นเป็นหลักร้อย)', 12300],
      ['ยอดจัด (ราคาส่ง − ดาวน์ขั้นต่ำ)', 28630],
    ]);
    expect(lines[0].source).toBe('ใบราคา · iPhone 17 Pro Max · 256GB · มือ 2');
    expect(lines[1].source).toBe('ข้อ 7 · iPhone 17 Pro Max · มือ 2 · เครื่องไทยได้ OVER เต็ม (เครื่องนอกได้ครึ่ง)');
    expect(lines[1].editKey).toBe('iPhone 17 Pro Max|HAND_2');
    expect(lines[3].source).toBe('ข้อ 2 · 30% ตั้งเฉพาะรุ่น iPhone 17 Pro Max · มือ 2 · ค่ากลางคือ 25%');
  });

  it('ขายต่ำกว่าราคาส่ง → บรรทัดส่วนต่างที่ร้านช่วยออก', () => {
    const lines = buildCalcLines(input, gfinQuoteAt(calcTables, product, 38000), calcTables.settings.minDownPct);
    expect(lines.find((l) => l.label.startsWith('− ส่วนต่าง'))).toEqual({
      label: '− ส่วนต่างที่ร้านช่วยออก (40,900 − 38,000)', amount: 2900,
    });
    expect(lines.find((l) => l.label.startsWith('= ดาวน์ลูกค้า'))!.amount).toBe(9400);
  });
});

describe('unavailableText', () => {
  it('ไม่มีเงื่อนไข / ไม่มีราคา', () => {
    const noRule = gfinQuoteAt(calcTables, gfinProductOf('iPhone 12', '64GB', 'HAND_2', 'THAI'), null);
    expect(unavailableText(noRule)).toBe('ยังไม่ตั้งเงื่อนไข GFIN ของรุ่นนี้ — ตั้งในแท็บ เงื่อนไข & ราคา');
    const noPrice = gfinQuoteAt(calcTables, gfinProductOf('iPhone 17 Pro Max', '512GB', 'HAND_2', 'THAI'), null);
    expect(unavailableText(noPrice)).toBe('ไม่มีราคาของรุ่น ความจุ และมือนี้ในใบราคา');
  });
});
