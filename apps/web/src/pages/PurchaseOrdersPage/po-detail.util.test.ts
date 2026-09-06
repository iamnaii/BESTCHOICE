import { describe, it, expect } from 'vitest';
import {
  accessoryFor,
  accessoryTitle,
  canReceive,
  dueStatus,
  itemCondition,
  paymentProgress,
  poHistory,
  receivingProgress,
} from './po-detail.util';
import type { GoodsReceivingRecord } from './types';

const owner = { id: 'u-owner', name: 'สุรชัย เจ้าของร้าน' };
const manager = { id: 'u-bm', name: 'สมชาย ผจก.ลาดพร้าว' };

const gr = (over: Partial<GoodsReceivingRecord> = {}): GoodsReceivingRecord => ({
  id: 'gr1',
  grNumber: 'GR-2026-09-004',
  createdAt: '2026-09-06T14:10:00.000Z',
  notes: null,
  receivedBy: owner,
  items: [
    { id: 'i1', imeiSerial: '356000000090601', serialNumber: null, photos: [], status: 'PASS', rejectReason: null, product: null },
  ],
  ...over,
});

describe('poHistory', () => {
  it('collapses create + order into one event when the owner ordered on creation', () => {
    const h = poHistory({
      status: 'ORDERED',
      orderDate: '2026-09-06',
      createdAt: '2026-09-06T15:31:00.000Z',
      orderedAt: '2026-09-06T15:31:02.000Z',
      createdBy: owner,
      approvedBy: null,
    });
    expect(h.map((e) => e.key)).toEqual(['created-ordered']);
    expect(h[0]).toMatchObject({ title: 'สร้างและสั่งซื้อ', by: owner.name, at: '2026-09-06T15:31:02.000Z' });
  });

  it('keeps create and approve+order apart when a manager created and the owner approved later', () => {
    const h = poHistory({
      status: 'ORDERED',
      orderDate: '2026-09-06',
      createdAt: '2026-09-06T13:41:00.000Z',
      orderedAt: '2026-09-06T13:55:00.000Z',
      createdBy: manager,
      approvedBy: owner,
    });
    expect(h.map((e) => e.title)).toEqual(['อนุมัติและสั่งซื้อ', 'สร้างใบสั่งซื้อ']);
    expect(h[0].by).toBe(owner.name);
    expect(h[1].by).toBe(manager.name);
  });

  it('labels a still-pending draft and has no order event yet', () => {
    const h = poHistory({ status: 'DRAFT', orderDate: '2026-09-06', createdAt: '2026-09-06T13:41:00.000Z', orderedAt: null, createdBy: manager, approvedBy: null });
    expect(h).toHaveLength(1);
    expect(h[0].title).toBe('สร้างใบสั่งซื้อ (รออนุมัติ)');
  });

  it('adds one event per goods receiving (newest first) with pass/reject counts and the record attached', () => {
    const early = gr({ id: 'gr1', grNumber: 'GR-1', createdAt: '2026-09-06T14:10:00.000Z' });
    const late = gr({
      id: 'gr2',
      grNumber: 'GR-2',
      createdAt: '2026-09-07T02:00:00.000Z',
      items: [
        { id: 'a', imeiSerial: '1', serialNumber: null, photos: [], status: 'PASS', rejectReason: null, product: null },
        { id: 'b', imeiSerial: '2', serialNumber: null, photos: [], status: 'REJECT', rejectReason: 'จอแตก', product: null },
      ],
    });
    const h = poHistory(
      { status: 'PARTIALLY_RECEIVED', orderDate: '2026-09-06', createdAt: '2026-09-06T13:41:00.000Z', orderedAt: '2026-09-06T13:55:00.000Z', createdBy: manager, approvedBy: owner },
      [early, late], // API order is newest first; helper must sort itself
    );
    expect(h.map((e) => e.key)).toEqual(['gr:gr2', 'gr:gr1', 'ordered', 'created']);
    expect(h[0]).toMatchObject({ title: 'รับสินค้า GR-2', detail: 'ผ่าน 1 ชิ้น · ไม่ผ่าน 1 ชิ้น', tone: 'success' });
    expect(h[0].receiving?.id).toBe('gr2');
    expect(h[1].detail).toBe('ผ่าน 1 ชิ้น');
  });

  it('puts a cancel on top even though the system stores no cancel time', () => {
    const h = poHistory({ status: 'CANCELLED', orderDate: '2026-09-06', createdAt: '2026-09-06T13:41:00.000Z', orderedAt: '2026-09-06T13:41:10.000Z', createdBy: owner, approvedBy: null });
    expect(h[0]).toMatchObject({ key: 'cancelled', at: null, tone: 'destructive' });
    expect(h[1].key).toBe('created-ordered');
  });

  it('falls back to orderDate when the API sends no createdAt', () => {
    const h = poHistory({ status: 'ORDERED', orderDate: '2026-09-06', orderedAt: '2026-09-06T15:31:02.000Z', createdBy: owner, approvedBy: null });
    // orderDate (midnight) is far from orderedAt → not collapsed, but nothing crashes
    expect(h.map((e) => e.key)).toEqual(['ordered', 'created']);
    expect(h[1].at).toBe('2026-09-06');
  });
});

describe('progress', () => {
  it('receivingProgress counts pieces across items and caps at the ordered quantity', () => {
    expect(receivingProgress({ items: [{ quantity: 1, receivedQty: 1 }, { quantity: 2, receivedQty: 0 }] })).toEqual({ received: 1, total: 3, remaining: 2, pct: 33 });
    expect(receivingProgress({ items: [{ quantity: 1, receivedQty: 3 }] })).toEqual({ received: 1, total: 1, remaining: 0, pct: 100 });
    expect(receivingProgress({ items: [] })).toEqual({ received: 0, total: 0, remaining: 0, pct: 0 });
  });

  it('paymentProgress reads net (falling back to total) and never goes negative', () => {
    expect(paymentProgress({ paidAmount: '14150', netAmount: '47165.60', totalAmount: '44080' })).toEqual({ paid: 14150, net: 47165.6, remaining: 33015.6, pct: 30 });
    expect(paymentProgress({ paidAmount: '0', netAmount: '10700', totalAmount: '10000' }).pct).toBe(0);
    expect(paymentProgress({ paidAmount: '12000', netAmount: '10700', totalAmount: '10000' })).toMatchObject({ remaining: 0, pct: 100 });
  });

  it('dueStatus: days ahead, today, overdue only while unpaid', () => {
    const now = new Date('2026-09-06T10:00:00');
    expect(dueStatus('2026-10-06', 'UNPAID', now)).toEqual({ text: 'อีก 30 วัน', overdue: false });
    expect(dueStatus('2026-09-06T23:00:00', 'UNPAID', now)).toEqual({ text: 'ครบกำหนดวันนี้', overdue: false });
    expect(dueStatus('2026-09-03', 'DEPOSIT_PAID', now)).toEqual({ text: 'เลยกำหนด 3 วัน', overdue: true });
    expect(dueStatus('2026-09-03', 'FULLY_PAID', now)).toEqual({ text: null, overdue: false });
    expect(dueStatus(null, 'UNPAID', now)).toEqual({ text: null, overdue: false });
  });
});

describe('item columns (same vocabulary as the purchase wizard)', () => {
  it('itemCondition maps the category to ใหม่ / มือสอง', () => {
    expect(itemCondition({ category: 'PHONE_NEW' })).toBe('ใหม่');
    expect(itemCondition({ category: 'PHONE_USED' })).toBe('มือสอง');
    expect(itemCondition({ category: 'ACCESSORY' })).toBe('-');
    expect(itemCondition({ category: null })).toBe('-');
  });

  it('accessory title + "สำหรับรุ่น" — a charger keeps its own model spec', () => {
    expect(accessoryTitle({ accessoryType: 'เคส', accessoryBrand: 'Spigen' })).toBe('เคส Spigen');
    expect(accessoryTitle({ accessoryType: null, accessoryBrand: null })).toBe('อุปกรณ์เสริม');
    expect(accessoryFor({ accessoryType: 'เคส', model: 'iPhone 17 Pro' })).toBe('สำหรับรุ่น iPhone 17 Pro');
    expect(accessoryFor({ accessoryType: 'ชุดชาร์จ', model: '20W USB-C' })).toBe('20W USB-C');
    expect(accessoryFor({ accessoryType: 'เคส', model: '' })).toBeNull();
  });

  it('canReceive only for approved/ordered/partially received', () => {
    expect(['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].every((status) => canReceive({ status }))).toBe(true);
    expect(['DRAFT', 'FULLY_RECEIVED', 'CANCELLED'].some((status) => canReceive({ status }))).toBe(false);
  });
});
