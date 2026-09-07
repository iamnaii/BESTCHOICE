import { describe, it, expect } from 'vitest';
import {
  canRejectFromQueue,
  filterByPoNumber,
  filterBySource,
  headerCheckState,
  primaryActionLabel,
} from './qcLabels';
import type { QcPendingProduct } from './useQcCenter';

const mk = (over: Partial<QcPendingProduct>): QcPendingProduct => ({
  id: 'x',
  name: 'iPhone 16',
  imeiSerial: null,
  serialNumber: null,
  status: 'PHOTO_PENDING',
  category: 'PHONE_USED',
  photos: [],
  createdAt: '',
  branch: null,
  supplier: null,
  po: null,
  source: 'PO',
  repossession: null,
  photoAngles: 0,
  ...over,
});

describe('filterByPoNumber', () => {
  const rows = [
    mk({ id: 'a', po: { id: '1', poNumber: 'PO-2026-06-001' } }),
    mk({ id: 'b', po: { id: '2', poNumber: 'PO-2026-06-002' }, name: 'Galaxy S24' }),
    mk({ id: 'c', imeiSerial: '359' }),
    mk({
      id: 'd',
      source: 'REPOSSESSION',
      repossession: { id: 'r1', contractId: 'c1', contractNumber: 'CT-2026-08-0042' },
    }),
  ];
  it('returns all when term is blank', () => {
    expect(filterByPoNumber(rows, '  ')).toHaveLength(4);
  });
  it('matches PO number', () => {
    expect(filterByPoNumber(rows, '06-002').map((r) => r.id)).toEqual(['b']);
  });
  it('matches product name and IMEI', () => {
    expect(filterByPoNumber(rows, 'galaxy').map((r) => r.id)).toEqual(['b']);
    expect(filterByPoNumber(rows, '359').map((r) => r.id)).toEqual(['c']);
  });
  it('matches the contract number of a repossessed device', () => {
    expect(filterByPoNumber(rows, '08-0042').map((r) => r.id)).toEqual(['d']);
  });
});

describe('filterBySource / canRejectFromQueue / primaryActionLabel', () => {
  const rows = [mk({ id: 'po' }), mk({ id: 'trade', source: 'TRADE_IN' }), mk({ id: 'repo', source: 'REPOSSESSION' })];
  it('ที่มาว่าง = ทุกแถว, เลือกแล้วเหลือเฉพาะที่มานั้น', () => {
    expect(filterBySource(rows, '')).toHaveLength(3);
    expect(filterBySource(rows, 'REPOSSESSION').map((r) => r.id)).toEqual(['repo']);
  });
  it('เครื่องยึดคืนไม่มีปุ่มไม่รับเข้าคลัง', () => {
    expect(canRejectFromQueue(mk({ source: 'REPOSSESSION' }))).toBe(false);
    expect(canRejectFromQueue(mk({ source: 'TRADE_IN' }))).toBe(true);
  });
  it('ครบ 6 มุมแล้วปุ่มเปลี่ยนเป็นตรวจรูปแล้วขึ้นขาย', () => {
    expect(primaryActionLabel(mk({ photoAngles: 4 }))).toBe('ไปถ่ายรูป');
    expect(primaryActionLabel(mk({ photoAngles: 6 }))).toBe('ตรวจรูปแล้วขึ้นขาย');
  });
});

describe('headerCheckState', () => {
  it('none / some / all', () => {
    expect(headerCheckState([], new Set())).toBe('none');
    expect(headerCheckState(['a', 'b'], new Set())).toBe('none');
    expect(headerCheckState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(headerCheckState(['a', 'b'], new Set(['a', 'b']))).toBe('all');
  });
});
