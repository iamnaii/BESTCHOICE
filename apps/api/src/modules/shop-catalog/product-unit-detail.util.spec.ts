import { parseAccessories, parseQcChecklist } from './product-unit-detail.util';

describe('parseQcChecklist', () => {
  it('reads the PO-receiving array shape', () => {
    expect(
      parseQcChecklist([
        { item: 'หน้าจอ', category: 'display', passed: true },
        { item: 'ลำโพง', category: 'audio', passed: false, note: 'เสียงแตก' },
      ]),
    ).toEqual([
      { item: 'หน้าจอ', passed: true },
      { item: 'ลำโพง', passed: false },
    ]);
  });
  it('returns [] for the trade-in object shape (not a checklist)', () => {
    expect(parseQcChecklist({ source: 'trade-in', tradeInId: 't1', agreedPrice: 5000 })).toEqual(
      [],
    );
  });
  // review round 1 [Important]: fixture ข้างบน key ไม่ชน item/passed เลย — mutation ที่ยอมรับ
  // bare object รอดได้; เคสนี้ pin ว่า "ไม่ใช่ array = ทิ้ง" แม้ object จะมี key ครบรูป
  it('returns [] for a bare object even when it carries item/passed keys', () => {
    expect(parseQcChecklist({ item: 'หน้าจอ', passed: true })).toEqual([]);
  });
  it('drops entries that are missing item or passed', () => {
    expect(parseQcChecklist([{ item: 'ok', passed: true }, { item: 'x' }, null, 'nope'])).toEqual([
      { item: 'ok', passed: true },
    ]);
  });
  it('returns [] for null/undefined/garbage', () => {
    expect(parseQcChecklist(null)).toEqual([]);
    expect(parseQcChecklist(undefined)).toEqual([]);
    expect(parseQcChecklist(42)).toEqual([]);
  });
  it('caps the list at 20 items so the payload cannot balloon', () => {
    const raw = Array.from({ length: 50 }, (_, i) => ({ item: `i${i}`, passed: true }));
    expect(parseQcChecklist(raw)).toHaveLength(20);
  });
});

describe('parseAccessories', () => {
  it('reads a string array and prepends กล่อง when hasBox', () => {
    expect(parseAccessories(['สายชาร์จ', 'หัวชาร์จ'], true)).toEqual([
      'กล่อง',
      'สายชาร์จ',
      'หัวชาร์จ',
    ]);
  });
  it('does not duplicate กล่อง when it is already listed', () => {
    expect(parseAccessories(['กล่อง', 'สายชาร์จ'], true)).toEqual(['กล่อง', 'สายชาร์จ']);
  });
  it('falls back to กล่อง only when the column is empty', () => {
    expect(parseAccessories(null, true)).toEqual(['กล่อง']);
    expect(parseAccessories(null, false)).toEqual([]);
  });
  it('ignores non-string entries and trims blanks', () => {
    expect(parseAccessories(['สายชาร์จ', 3, '', '  หูฟัง '], false)).toEqual(['สายชาร์จ', 'หูฟัง']);
  });
});
