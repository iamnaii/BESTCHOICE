import { describe, it, expect } from 'vitest';
import { receiveProgress, isOverdue, supplierContactIsRedundant, canCancel } from './po-list.util';

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
