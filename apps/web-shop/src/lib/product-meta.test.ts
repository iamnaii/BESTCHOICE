import { describe, expect, it } from 'vitest';
import { buildProductMetaDescription, buildProductMetaTitle } from './product-meta';

const name = 'Apple iPhone 15 128GB สีฟ้า';

// ถ้อยคำเจ้าของอนุมัติ 27 พ.ย. 2569 (รูปแบบเดียวกับการ์ดแชร์ LINE/Facebook)
describe('buildProductMetaDescription', () => {
  it('มือสอง: สภาพ · แบต · ประกันร้าน · ราคา', () => {
    expect(
      buildProductMetaDescription({
        name,
        condition: 'USED',
        batteryHealth: 84,
        shopWarrantyDays: 60,
        price: 18900,
      }),
    ).toBe(
      'Apple iPhone 15 128GB สีฟ้า · มือสอง · แบต 84% · ประกันร้าน 60 วัน · ฿18,900 — ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี',
    );
  });

  it('มือ 1: ไม่มีแบต ไม่มีประกันร้าน (ประกันร้าน 0 วันไม่แสดง)', () => {
    expect(
      buildProductMetaDescription({ name, condition: 'NEW', shopWarrantyDays: 0, price: 25900 }),
    ).toBe(
      'Apple iPhone 15 128GB สีฟ้า · เครื่องใหม่ มือ 1 · ฿25,900 — ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี',
    );
  });

  it.each([null, 0])('ไม่มีราคา (%s) → สอบถามราคา', (price) => {
    expect(buildProductMetaDescription({ name, condition: 'USED', batteryHealth: 90, price })).toBe(
      'Apple iPhone 15 128GB สีฟ้า · มือสอง · แบต 90% · สอบถามราคา — ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี',
    );
  });

  it('ไม่มีข้อมูลแบต → ไม่มีช่องแบต', () => {
    expect(
      buildProductMetaDescription({ name, condition: 'USED', shopWarrantyDays: 60, price: 18900 }),
    ).toBe(
      'Apple iPhone 15 128GB สีฟ้า · มือสอง · ประกันร้าน 60 วัน · ฿18,900 — ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี',
    );
  });
});

describe('buildProductMetaTitle', () => {
  it('มือสองมีแบต → ต่อท้าย "มือสอง แบต N%"', () => {
    expect(buildProductMetaTitle({ name, condition: 'USED', batteryHealth: 84 })).toBe(
      'Apple iPhone 15 128GB สีฟ้า มือสอง แบต 84%',
    );
  });

  it('มือสองไม่มีข้อมูลแบต → ต่อท้าย "มือสอง"', () => {
    expect(buildProductMetaTitle({ name, condition: 'USED' })).toBe(
      'Apple iPhone 15 128GB สีฟ้า มือสอง',
    );
  });

  it('มือ 1 → ต่อท้าย "มือ 1" (ไม่ใส่แบตแม้มีค่า)', () => {
    expect(buildProductMetaTitle({ name, condition: 'NEW', batteryHealth: 100 })).toBe(
      'Apple iPhone 15 128GB สีฟ้า มือ 1',
    );
  });
});
