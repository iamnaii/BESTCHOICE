import { describe, it, expect } from 'vitest';
import { filterByPoNumber, headerCheckState } from './qcLabels';
import type { QcPendingProduct } from './useQcCenter';

const mk = (over: Partial<QcPendingProduct>): QcPendingProduct => ({
  id: 'x',
  name: 'iPhone 16',
  imeiSerial: null,
  serialNumber: null,
  status: 'QC_PENDING',
  category: 'PHONE_NEW',
  photos: [],
  createdAt: '',
  branch: null,
  supplier: null,
  po: null,
  ...over,
});

describe('filterByPoNumber', () => {
  const rows = [
    mk({ id: 'a', po: { id: '1', poNumber: 'PO-2026-06-001' } }),
    mk({ id: 'b', po: { id: '2', poNumber: 'PO-2026-06-002' }, name: 'Galaxy S24' }),
    mk({ id: 'c', imeiSerial: '359' }),
  ];
  it('returns all when term is blank', () => {
    expect(filterByPoNumber(rows, '  ')).toHaveLength(3);
  });
  it('matches PO number', () => {
    expect(filterByPoNumber(rows, '06-002').map((r) => r.id)).toEqual(['b']);
  });
  it('matches product name and IMEI', () => {
    expect(filterByPoNumber(rows, 'galaxy').map((r) => r.id)).toEqual(['b']);
    expect(filterByPoNumber(rows, '359').map((r) => r.id)).toEqual(['c']);
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
