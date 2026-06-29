import { describe, it, expect } from 'vitest';
import { buildDirectReceiveItem } from './usePurchaseOrdersData';
import type { ReceivingUnitForm } from '../types';

const baseUnit = (over: Partial<ReceivingUnitForm>): ReceivingUnitForm => ({
  poItemId: '', label: '', category: 'PHONE_NEW', imeiSerial: '', serialNumber: '',
  status: 'PASS', rejectReason: '', defectReason: '', batteryHealth: '', warrantyExpired: false,
  warrantyExpireDate: '', hasBox: true, checklist: [], sellingPrice: '', photos: [], costPrice: '0',
  ...over,
});

describe('buildDirectReceiveItem', () => {
  it('sends costPrice as unitPrice and quantity 1; omits defectReason on PASS', () => {
    const out = buildDirectReceiveItem(baseUnit({ costPrice: '30000', imeiSerial: 'IMEI-1', sellingPrice: '39900', defectReason: 'SCREEN' }));
    expect(out.unitPrice).toBe(30000);
    expect(out.quantity).toBe(1);
    expect(out.sellingPrice).toBe(39900);
    expect(out.defectReason).toBeUndefined(); // PASS drops defectReason
    expect(out.imeiSerial).toBe('IMEI-1');
  });

  it('includes defectReason + rejectReason only on REJECT, drops sellingPrice', () => {
    const out = buildDirectReceiveItem(baseUnit({ status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN', sellingPrice: '39900', costPrice: '30000' }));
    expect(out.defectReason).toBe('SCREEN');
    expect(out.rejectReason).toBe('จอแตก');
    expect(out.sellingPrice).toBeUndefined();
  });

  it('attaches used-phone fields + checklistResults only for PHONE_USED PASS', () => {
    const out = buildDirectReceiveItem(baseUnit({ category: 'PHONE_USED', costPrice: '12000', imeiSerial: 'X', batteryHealth: '88', warrantyExpired: true, checklist: [{ item: 'จอ', category: 'ภายนอก', passed: true, note: '' }] }));
    expect(out.batteryHealth).toBe(88);
    expect(out.warrantyExpired).toBe(true);
    expect(out.checklistResults).toEqual([{ item: 'จอ', category: 'ภายนอก', passed: true }]);
  });

  it('includes photos only when present', () => {
    expect(buildDirectReceiveItem(baseUnit({ photos: [] })).photos).toBeUndefined();
    expect(buildDirectReceiveItem(baseUnit({ photos: ['data:img'] })).photos).toEqual(['data:img']);
  });
});
