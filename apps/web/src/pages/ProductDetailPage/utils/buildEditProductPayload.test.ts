import { describe, it, expect } from 'vitest';
import { buildEditProductPayload, type EditForm } from './buildEditProductPayload';

function baseForm(overrides: Partial<EditForm> = {}): EditForm {
  return {
    name: 'iPhone 13',
    brand: 'Apple',
    model: 'iPhone 13',
    color: '',
    storage: '',
    imeiSerial: '',
    serialNumber: '',
    category: 'PHONE_NEW',
    costPrice: '15000',
    status: 'IN_STOCK',
    batteryHealth: '',
    warrantyExpired: false,
    warrantyExpireDate: '',
    hasBox: false,
    accessoryType: '',
    accessoryBrand: '',
    conditionGrade: '',
    shopWarrantyDays: '',
    accessoriesIncluded: '',
    cosmeticNotes: '',
    deviceOrigin: '',
    partsHistory: '',
    partsHistoryNote: '',
    ...overrides,
  };
}

describe('buildEditProductPayload', () => {
  it('ที่มาเครื่อง + ประวัติอะไหล่ ส่งเสมอ · ค่าว่าง = null (ล้างกลับเป็นยังไม่ระบุได้)', () => {
    const payload = buildEditProductPayload(
      baseForm({ category: 'PHONE_USED', deviceOrigin: 'IMPORTED', partsHistory: 'BATTERY_NON_GENUINE', partsHistoryNote: '  แบตใหม่ 100% ' }),
    );
    expect(payload).toMatchObject({ deviceOrigin: 'IMPORTED', partsHistory: 'BATTERY_NON_GENUINE', partsHistoryNote: 'แบตใหม่ 100%' });
    expect(buildEditProductPayload(baseForm())).toMatchObject({ deviceOrigin: null, partsHistory: null, partsHistoryNote: null });
  });

  it('ไม่ระบุประวัติอะไหล่ → ไม่เก็บรายละเอียดค้างไว้', () => {
    const payload = buildEditProductPayload(baseForm({ partsHistory: '', partsHistoryNote: 'ค้างจากค่าเดิม' }));
    expect(payload.partsHistoryNote).toBeNull();
  });

  it('อุปกรณ์เสริม → ไม่แตะที่มาเครื่อง/ประวัติอะไหล่', () => {
    const payload = buildEditProductPayload(baseForm({ category: 'ACCESSORY' }));
    expect(payload).not.toHaveProperty('deviceOrigin');
    expect(payload).not.toHaveProperty('partsHistory');
  });

  // final-review N2: the exact scenario a role that can edit but can't see cost hits —
  // GET /products/:id strips costPrice server-side, so openEditProduct prefills the field
  // with '' (product.costPrice ?? ''). Saving must not silently zero out the real cost.
  it('[N2] costPrice ว่าง (โดน server strip) → payload ไม่มี key costPrice เลย', () => {
    const payload = buildEditProductPayload(baseForm({ costPrice: '' }));
    expect(payload).not.toHaveProperty('costPrice');
    expect(payload.costPrice).toBeUndefined();
  });

  it('costPrice มีค่า → parseFloat เป็นตัวเลขตามปกติ', () => {
    const payload = buildEditProductPayload(baseForm({ costPrice: '15900' }));
    expect(payload.costPrice).toBe(15900);
  });
});
