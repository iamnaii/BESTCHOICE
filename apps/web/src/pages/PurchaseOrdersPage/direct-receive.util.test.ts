import { describe, it, expect } from 'vitest';
import { lineToUnits, buildDirectReceivePayload } from './direct-receive.util';
import type { ItemForm, PoFormState, ReceivingUnitForm } from './types';

const blank: ItemForm = {
  brand: '', category: '', model: '', color: '', storage: '', quantity: '1', unitPrice: '',
  accessoryType: '', accessoryBrand: '',
};
const phone: ItemForm = { ...blank, brand: 'Apple', category: 'PHONE_NEW', model: 'iPhone 17 Pro', color: 'Deep Blue', storage: '256GB', quantity: '2', unitPrice: '42900' };
const film: ItemForm = { ...blank, category: 'ACCESSORY', accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar', quantity: '1', unitPrice: '35', sourceName: 'ฟิล์มกระจก iPhone 16 - iStar', sourceCode: 'F1601', sourceInStock: 13 };
const form: PoFormState = {
  supplierId: 's1', orderDate: '2026-09-06', expectedDate: '', notes: 'ซื้อสด', discount: '35', discountAfterVat: '',
  paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: '42900', paymentNotes: 'จ่ายหน้าร้าน',
};

describe('lineToUnits — one table row → quantity units for ตรวจรับ', () => {
  it('one unit per piece, labelled from the row, cost = the row price', () => {
    const units = [phone, film].flatMap(lineToUnits);
    expect(units.map((u) => `${u.label} · ${u.category} · ฿${u.costPrice}`)).toEqual([
      'Apple iPhone 17 Pro Deep Blue 256GB #1 · PHONE_NEW · ฿42900',
      'Apple iPhone 17 Pro Deep Blue 256GB #2 · PHONE_NEW · ฿42900',
      'ฟิล์มกระจก iPhone 16 - iStar #1 · ACCESSORY · ฿35',
    ]);
    // a phone waits for an explicit ผ่าน/ไม่ผ่าน on its own screen; an accessory line starts counted as received
    expect(units[0]).toMatchObject({ brand: 'Apple', model: 'iPhone 17 Pro', storage: '256GB', status: '', imeiSerial: '', installmentPrice: '', photos: [] });
    expect(units[2]).toMatchObject({ category: 'ACCESSORY', status: 'PASS' });
  });
});

describe('buildDirectReceivePayload — step 3 money + payment travel with the units', () => {
  const unit = { ...lineToUnits(phone)[0], imeiSerial: '356000000090601', sellingPrice: '45900' } as ReceivingUnitForm;

  it('sends discount + payment fields when something was paid', () => {
    expect(buildDirectReceivePayload({ form, units: [unit], attachments: ['data:image/png;base64,slip'], today: '2026-09-06' })).toEqual({
      supplierId: 's1', orderDate: '2026-09-06', notes: 'ซื้อสด', items: [unit],
      discount: 35, discountAfterVat: undefined,
      paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: 42900, paymentNotes: 'จ่ายหน้าร้าน', attachments: ['data:image/png;base64,slip'],
    });
  });

  it('leaves the payment out on credit (UNPAID)', () => {
    const out = buildDirectReceivePayload({ form: { ...form, paymentStatus: 'UNPAID', paidAmount: '', discount: '' }, units: [unit], attachments: [], today: '2026-09-06' });
    expect(out).toEqual({ supplierId: 's1', orderDate: '2026-09-06', notes: 'ซื้อสด', items: [unit], discount: undefined, discountAfterVat: undefined });
  });
});
