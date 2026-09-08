import { describe, it, expect } from 'vitest';
import { receiveProgress, isOverdue, supplierContactIsRedundant, canCancel, splitLeadingTag, pieceCount, itemsSummary } from './po-list.util';

describe('receiveProgress', () => {
  it('sums received/ordered across items and computes pct', () => {
    const po = { items: [{ quantity: 7, receivedQty: 3 }, { quantity: 3, receivedQty: 0 }] };
    expect(receiveProgress(po)).toEqual({ received: 3, ordered: 10, pct: 30 });
  });

  it('caps pct at 100 when over-received (defensive)', () => {
    const po = { items: [{ quantity: 2, receivedQty: 5 }] };
    expect(receiveProgress(po).pct).toBe(100);
  });

  it('returns pct 0 (not NaN) for an empty PO', () => {
    expect(receiveProgress({ items: [] })).toEqual({ received: 0, ordered: 0, pct: 0 });
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-06-29T00:00:00Z');

  it('is true for an ORDERED PO past its expectedDate', () => {
    expect(isOverdue({ status: 'ORDERED', expectedDate: '2026-06-20' }, now)).toBe(true);
  });

  it('is false for an ORDERED PO not yet due', () => {
    expect(isOverdue({ status: 'ORDERED', expectedDate: '2026-07-10' }, now)).toBe(false);
  });

  it('is false when not ORDERED even if past due (e.g. APPROVED / PARTIALLY_RECEIVED)', () => {
    expect(isOverdue({ status: 'APPROVED', expectedDate: '2026-06-20' }, now)).toBe(false);
    expect(isOverdue({ status: 'PARTIALLY_RECEIVED', expectedDate: '2026-06-20' }, now)).toBe(false);
  });

  it('is false when expectedDate is null', () => {
    expect(isOverdue({ status: 'ORDERED', expectedDate: null }, now)).toBe(false);
  });
});

describe('supplierContactIsRedundant', () => {
  it('is true when contactName equals name (case/space-insensitive)', () => {
    expect(supplierContactIsRedundant({ name: 'ACME', contactName: ' acme ' })).toBe(true);
  });
  it('is false when contactName differs', () => {
    expect(supplierContactIsRedundant({ name: 'ACME Co.', contactName: 'คุณสมชาย' })).toBe(false);
  });
  it('is false when contactName is null/empty', () => {
    expect(supplierContactIsRedundant({ name: 'ACME', contactName: null })).toBe(false);
    expect(supplierContactIsRedundant({ name: 'ACME', contactName: '' })).toBe(false);
  });
});

// Owner 2026-09-06: an ORDERED PO with nothing received yet can still be cancelled (the API's
// cancel() rule) — the list/card must offer the action, not just for DRAFT (found by QA).
describe('canCancel', () => {
  const po = (status: string, received: number[] = [0]) => ({
    status,
    items: received.map((r) => ({ quantity: 2, receivedQty: r })),
  });
  it('DRAFT (and legacy APPROVED) can be cancelled', () => {
    expect(canCancel(po('DRAFT'))).toBe(true);
    expect(canCancel(po('APPROVED'))).toBe(true);
  });
  it('ORDERED with nothing received can be cancelled', () => {
    expect(canCancel(po('ORDERED', [0, 0]))).toBe(true);
  });
  it('ORDERED with any piece received cannot', () => {
    expect(canCancel(po('ORDERED', [0, 1]))).toBe(false);
  });
  it('received / cancelled POs cannot', () => {
    expect(canCancel(po('PARTIALLY_RECEIVED', [1]))).toBe(false);
    expect(canCancel(po('FULLY_RECEIVED', [2]))).toBe(false);
    expect(canCancel(po('CANCELLED'))).toBe(false);
  });
});

describe('list cells that must never wrap (2026-09-07 redesign)', () => {
  const item = (over: Record<string, unknown>) => ({
    brand: 'Apple', model: 'iPhone 17 Pro', category: 'PHONE_NEW', quantity: 1, accessoryType: null, accessoryBrand: null, ...over,
  });

  it('splitLeadingTag lifts a "[tag]" prefix off a supplier name and leaves plain names alone', () => {
    expect(splitLeadingTag('[ทดสอบระบบ] QA ผู้ขาย VAT เครดิต')).toEqual({ tag: 'ทดสอบระบบ', name: 'QA ผู้ขาย VAT เครดิต' });
    expect(splitLeadingTag('บริษัท ไอเดียโมบาย จำกัด')).toEqual({ tag: null, name: 'บริษัท ไอเดียโมบาย จำกัด' });
    expect(splitLeadingTag('[ว่าง]')).toEqual({ tag: null, name: '[ว่าง]' });
  });

  it('pieceCount sums the ordered quantity', () => {
    expect(pieceCount({ items: [item({ quantity: 2 }), item({ quantity: 3 })] })).toBe(5);
  });

  it('itemsSummary names each line once with its count, phones by model, accessories by type + brand', () => {
    expect(
      itemsSummary({
        items: [
          item({ quantity: 2 }),
          item({ model: 'iPhone 15', category: 'PHONE_USED' }),
          item({ brand: '', model: 'iPhone 17 Pro', category: 'ACCESSORY', accessoryType: 'เคส', accessoryBrand: 'Spigen', quantity: 2 }),
        ],
      }),
    ).toBe('iPhone 17 Pro ×2, iPhone 15, เคส Spigen ×2');
  });

  it('itemsSummary adds the condition on a single-line PO and uses the SKU name for coded accessories', () => {
    expect(itemsSummary({ items: [item({ model: 'iPhone 14', category: 'PHONE_USED' })] })).toBe('iPhone 14 · มือสอง');
    expect(itemsSummary({ items: [item({ category: 'ACCESSORY', model: 'ฟิล์มกระจก iPhone 16 - iStar', accessoryType: 'F1601', accessoryBrand: 'iStar', quantity: 3 })] })).toBe('ฟิล์มกระจก iPhone 16 - iStar ×3');
  });
});
