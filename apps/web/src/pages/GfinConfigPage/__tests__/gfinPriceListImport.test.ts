import { describe, it, expect } from 'vitest';
import {
  GFIN_IMPORT_HEADERS,
  buildGfinImportReview,
  type ExistingMaxPrice,
} from '../gfinPriceListImport';

const row = (model: string, storage: string, hand: unknown, price: unknown) => ({
  'รุ่น': model,
  'ความจุ': storage,
  'มือ 1/มือ 2': hand,
  'ราคา': price,
});

const existing = (over: Partial<ExistingMaxPrice> = {}): ExistingMaxPrice => ({
  id: 'm1',
  gfinSeries: 'iPhone 15',
  gfinVariant: null,
  storage: '128GB',
  condition: 'HAND_2',
  maxPrice: '16900.00',
  modelMatchPattern: 'iPhone 15',
  isActive: true,
  ...over,
});

describe('buildGfinImportReview', () => {
  it('หัวคอลัมน์ตามสเปค 7.7', () => {
    expect([...GFIN_IMPORT_HEADERS]).toEqual(['รุ่น', 'ความจุ', 'มือ 1/มือ 2', 'ราคา']);
  });

  it('เพิ่ม / แก้ / ข้ามราคาเท่าเดิม / ข้ามแถวผิดหรือซ้ำ · นับแถวรูปแบบเก่าที่มีรุ่นย่อย', () => {
    const review = buildGfinImportReview(
      [
        row('iPhone 15', '128GB', 'มือ 2', 16900),
        row('iPhone 15', '256 GB', 'มือ 2', 17900),
        row('iPhone 15 Pro Max', '256GB', 'มือ 1', 34900),
        row('iPhone 15 Pro Max', '256GB', 'มือ1', 34900),
        row('iPhone 13', '128GB', 'มือสาม', 12900),
        row('iPhone 13', '128GB', 'มือ 2', 0),
        row('', '', '', ''),
      ],
      [
        existing(),
        existing({ id: 'm2', storage: '256GB', maxPrice: '17000.00', isActive: false }),
        existing({ id: 'old', gfinSeries: 'iPhone 14', gfinVariant: 'Pro' }),
      ],
    );
    expect(review.rows).toEqual([
      { rowNumber: 2, label: 'iPhone 15 128GB มือ 2', action: 'SKIP', detail: 'ราคาเท่าเดิม' },
      { rowNumber: 3, label: 'iPhone 15 256GB มือ 2', action: 'UPDATE', detail: 'ราคา 17,000 → 17,900 · เปิดใช้อีกครั้ง' },
      { rowNumber: 4, label: 'iPhone 15 Pro Max 256GB มือ 1', action: 'ADD' },
      { rowNumber: 5, label: 'iPhone 15 Pro Max 256GB มือ1', action: 'SKIP', detail: 'ซ้ำกับแถว 4' },
      { rowNumber: 6, label: 'iPhone 13 128GB มือสาม', action: 'SKIP', detail: 'ช่อง มือ 1/มือ 2 ต้องเป็น มือ 1 หรือ มือ 2' },
      { rowNumber: 7, label: 'iPhone 13 128GB มือ 2', action: 'SKIP', detail: 'ราคาต้องเป็นตัวเลขมากกว่า 0' },
    ]);
    expect(review.toSend).toEqual([
      { model: 'iPhone 15', storage: '256GB', condition: 'HAND_2', maxPrice: 17900 },
      { model: 'iPhone 15 Pro Max', storage: '256GB', condition: 'HAND_1', maxPrice: 34900 },
    ]);
    expect(review.legacyActive).toBe(1);
  });

  it('หัวคอลัมน์ที่มีช่องว่างหัวท้ายยังอ่านได้', () => {
    const spaced = {
      ' รุ่น ': 'iPhone 18',
      'ความจุ ': '256GB',
      ' มือ 1/มือ 2': 'มือ 1',
      'ราคา  ': 40000,
    };
    const review = buildGfinImportReview([spaced], []);
    expect(review.toSend).toEqual([{ model: 'iPhone 18', storage: '256GB', condition: 'HAND_1', maxPrice: 40000 }]);
  });

  it('แถวผิดไม่บังแถวถูกที่มีคีย์เดียวกัน · แถวซ้ำหลังสุดถูกข้ามเสมอ', () => {
    const review = buildGfinImportReview(
      [
        row('iPhone 18', '256GB', 'มือ 1', 0),
        row('iPhone 18', '256GB', 'มือ 1', 40000),
        row('iphone 18', '256 gb', 'มือ 1', 41000),
      ],
      [],
    );
    expect(review.rows.map((r) => [r.rowNumber, r.action, r.detail])).toEqual([
      [2, 'SKIP', 'ราคาต้องเป็นตัวเลขมากกว่า 0'],
      [3, 'ADD', undefined],
      [4, 'SKIP', 'ซ้ำกับแถว 3'],
    ]);
    expect(review.toSend).toEqual([{ model: 'iPhone 18', storage: '256GB', condition: 'HAND_1', maxPrice: 40000 }]);
  });

  it('ราคาทศนิยมเกิน 2 ตำแหน่ง → ข้ามพร้อมเหตุผล ไม่ส่ง (เซิร์ฟเวอร์ปฏิเสธทั้งชุด) · 2 ตำแหน่งยังรับ', () => {
    const review = buildGfinImportReview(
      [row('iPhone 15', '128GB', 'มือ 2', 16900.125), row('iPhone 15', '256GB', 'มือ 2', '17,900.50')],
      [],
    );
    expect(review.rows.map((r) => [r.rowNumber, r.action, r.detail])).toEqual([
      [2, 'SKIP', 'ราคาต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง'],
      [3, 'ADD', undefined],
    ]);
    expect(review.toSend).toEqual([{ model: 'iPhone 15', storage: '256GB', condition: 'HAND_2', maxPrice: 17900.5 }]);
  });

  it('มือ 1 กับ มือ 2 ของรุ่นเดียวกันไม่ถือว่าซ้ำ', () => {
    const review = buildGfinImportReview(
      [row('iPhone 18', '256GB', 'มือ 1', 40000), row('iPhone 18', '256GB', 'มือ 2', 30000)],
      [],
    );
    expect(review.toSend).toHaveLength(2);
  });
});
