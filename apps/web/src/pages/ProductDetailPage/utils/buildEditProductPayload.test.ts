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
    ...overrides,
  };
}

describe('buildEditProductPayload', () => {
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
