import { describe, it, expect } from 'vitest';
import {
  REASON_OPTIONS,
  buildRequestFormData,
  canCancel,
  canDecide,
  rejectFormErrors,
  requestFormErrors,
} from '../stock-adjustment.util';
import type { StockAdjustmentRow } from '../types';

const row = (overrides: Partial<StockAdjustmentRow> = {}): StockAdjustmentRow =>
  ({
    id: 'adj-1',
    requestNumber: 'SA-20261005-0001',
    reason: 'LOST',
    status: 'PENDING_APPROVAL',
    previousStatus: 'IN_STOCK',
    notes: null,
    photos: [],
    createdAt: '2026-10-05T03:00:00.000Z',
    approvedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    canceledAt: null,
    costAmount: null,
    inventoryAccountCode: null,
    inventoryBooked: null,
    bookedSource: null,
    journalEntryId: null,
    journalEntryNo: null,
    product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15', imeiSerial: '3500', costPrice: '12000.00', category: 'PHONE_NEW', status: 'ADJUSTMENT_PENDING', deletedAt: null },
    branch: { id: 'b1', name: 'ลาดพร้าว' },
    adjustedBy: { id: 'sales-1', name: 'สมชาย' },
    ...overrides,
  }) as StockAdjustmentRow;

describe('REASON_OPTIONS', () => {
  it('มี 6 เหตุผล · DAMAGED บังคับรูป · DAMAGED/LOST/WRITE_OFF พักขายเครื่อง · ไม่มีช่องผู้อนุมัติ', () => {
    expect(REASON_OPTIONS.map((o) => o.value).sort()).toEqual(['CORRECTION', 'DAMAGED', 'FOUND', 'LOST', 'OTHER', 'WRITE_OFF']);
    const by = Object.fromEntries(REASON_OPTIONS.map((o) => [o.value, o]));
    expect(by.DAMAGED.requiresPhoto).toBe(true);
    expect(by.LOST.requiresPhoto).toBe(false);
    expect([by.DAMAGED.holdsProduct, by.LOST.holdsProduct, by.WRITE_OFF.holdsProduct]).toEqual([true, true, true]);
    expect([by.FOUND.holdsProduct, by.CORRECTION.holdsProduct, by.OTHER.holdsProduct]).toEqual([false, false, false]);
  });
});

describe('requestFormErrors', () => {
  it('ไม่มีเครื่อง + ไม่เลือกเหตุผล → 2 ข้อ', () => {
    const errors = requestFormErrors({ productId: '', reason: '', photoCount: 0, notes: '' });
    expect(errors).toHaveLength(2);
    expect(errors.join(' ')).toMatch(/เครื่อง/);
    expect(errors.join(' ')).toMatch(/เหตุผล/);
  });
  it('DAMAGED ไม่มีรูป → บังคับรูป · มีรูปแล้วผ่าน', () => {
    expect(requestFormErrors({ productId: 'p1', reason: 'DAMAGED', photoCount: 0, notes: '' }).join(' ')).toMatch(/รูป/);
    expect(requestFormErrors({ productId: 'p1', reason: 'DAMAGED', photoCount: 1, notes: '' })).toEqual([]);
  });
  it('LOST ไม่มีรูป → ว่าง (ไม่บังคับ)', () => {
    expect(requestFormErrors({ productId: 'p1', reason: 'LOST', photoCount: 0, notes: '' })).toEqual([]);
  });
  it('หมายเหตุเกิน 1,000 ตัวอักษร → error', () => {
    expect(requestFormErrors({ productId: 'p1', reason: 'LOST', photoCount: 0, notes: 'x'.repeat(1001) }).join(' ')).toMatch(/1,000/);
  });
});

describe('rejectFormErrors', () => {
  it('สั้นกว่า 10 → error · 10–500 → ว่าง · เกิน 500 → error', () => {
    expect(rejectFormErrors('สั้น')).toHaveLength(1);
    expect(rejectFormErrors('   ')).toHaveLength(1);
    expect(rejectFormErrors('เครื่องยังอยู่ ให้ตรวจใหม่')).toEqual([]);
    expect(rejectFormErrors('ก'.repeat(501))).toHaveLength(1);
  });
});

describe('canCancel / canDecide', () => {
  it('canCancel: PENDING และ (ผู้ขอ หรือ OWNER)', () => {
    expect(canCancel(row(), { id: 'sales-1', role: 'SALES' })).toBe(true);
    expect(canCancel(row(), { id: 'owner', role: 'OWNER' })).toBe(true);
    expect(canCancel(row(), { id: 'other', role: 'BRANCH_MANAGER' })).toBe(false);
    expect(canCancel(row({ status: 'APPROVED' }), { id: 'sales-1', role: 'SALES' })).toBe(false);
  });
  it('canDecide: PENDING และ OWNER เท่านั้น', () => {
    expect(canDecide(row(), { id: 'owner', role: 'OWNER' })).toBe(true);
    expect(canDecide(row(), { id: 'bm', role: 'BRANCH_MANAGER' })).toBe(false);
    expect(canDecide(row({ status: 'REJECTED' }), { id: 'owner', role: 'OWNER' })).toBe(false);
  });
});

describe('buildRequestFormData', () => {
  it('ใส่ productId/reason/notes และ photos ครบทุกไฟล์ · ไม่มี approverId', () => {
    const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })];
    const fd = buildRequestFormData({ productId: 'p1', reason: 'DAMAGED', photoCount: 2, notes: 'ตกแตก' }, files);
    expect(fd.get('productId')).toBe('p1');
    expect(fd.get('reason')).toBe('DAMAGED');
    expect(fd.get('notes')).toBe('ตกแตก');
    expect(fd.getAll('photos')).toHaveLength(2);
    expect(fd.has('approverId')).toBe(false);
  });
  it('หมายเหตุว่าง → ไม่ส่งฟิลด์ notes', () => {
    const fd = buildRequestFormData({ productId: 'p1', reason: 'LOST', photoCount: 0, notes: '   ' }, []);
    expect(fd.has('notes')).toBe(false);
  });
});
