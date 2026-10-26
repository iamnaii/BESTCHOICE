import { deliveredAccessoriesText, normalizeDeliveredAccessories } from '../utils/delivered-accessories';

describe('delivered-accessories util (M3)', () => {
  it('normalize: ทุกคีย์มีค่า · other ตัดช่องว่าง · ช่องว่างล้วน/ไม่ส่ง = null', () => {
    expect(normalizeDeliveredAccessories({ box: true, other: '  ฟิล์ม  ' })).toEqual({ box: true, charger: false, case: false, other: 'ฟิล์ม' });
    expect(normalizeDeliveredAccessories({ other: '   ' })).toEqual({ box: false, charger: false, case: false, other: null });
    expect(normalizeDeliveredAccessories({})).toEqual({ box: false, charger: false, case: false, other: null });
  });
  it('text: เรียง กล่อง, สายชาร์จ, เคส, อื่น ๆ — … · ไม่มีอะไร = null · ไม่ส่ง = null', () => {
    expect(deliveredAccessoriesText({ box: true, charger: true, case: true, other: 'ฟิล์ม' })).toBe('กล่อง, สายชาร์จ, เคส, อื่น ๆ — ฟิล์ม');
    expect(deliveredAccessoriesText({ box: false, charger: false, case: false, other: null })).toBeNull();
    expect(deliveredAccessoriesText(null)).toBeNull();
    expect(deliveredAccessoriesText(undefined)).toBeNull();
  });
});
