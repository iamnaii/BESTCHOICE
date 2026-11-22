import { describe, expect, it } from 'vitest';
import { buildStockColumns } from '../stockColumns';

const columns = (scope: 'devices' | 'accessories' | 'all', isManager = true) =>
  buildStockColumns({
    isManager,
    inventoryScope: scope,
    view: 'ready',
    filterCategory: '',
    listProducts: [],
    selectableProducts: [],
    selectedIds: new Set(),
    toggleSelectAll: () => {},
    toggleSelect: () => {},
    navigateToProduct: () => {},
    openPriceEdit: () => {},
    setAccessoryGroupId: () => {},
    installments: new Map(),
  });

describe('stock comparison column layouts', () => {
  it.each(['devices', 'accessories', 'all'] as const)(
    '%s uses proportional columns instead of forcing a horizontal scroller',
    (scope) => {
      const cols = columns(scope);
      expect(cols.every((c) => c.width?.endsWith('%'))).toBe(true);
      expect(cols.reduce((total, c) => total + parseFloat(c.width!), 0)).toBeCloseTo(100);
    },
  );
  it('keeps the full IMEI column always visible and combines each provider into one cell', () => {
    const cols = columns('devices');
    expect(cols.find((c) => c.key === 'imeiSerial')).toMatchObject({ hideable: false });
    expect(cols.filter((c) => ['downPayment', 'gfin'].includes(c.key)).map((c) => c.label)).toEqual(
      ['BESTCHOICE', 'GFIN'],
    );
    expect(cols.some((c) => c.key === 'monthlyPayment')).toBe(false);
  });
  it('uses SKU, available stock and margin for accessories, excluding device and installment fields', () => {
    const keys = columns('accessories').map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(['productCode', 'quantity', 'costPrice', 'cashPrice', 'margin']),
    );
    for (const key of [
      'imeiSerial',
      'batteryHealth',
      'hasBox',
      'warrantyExpireDate',
      'downPayment',
      'gfin',
    ])
      expect(keys).not.toContain(key);
  });
  it('never sends cost or margin columns to sales staff', () => {
    expect(columns('accessories', false).map((c) => c.key)).not.toContain('costPrice');
    expect(columns('accessories', false).map((c) => c.key)).not.toContain('margin');
  });
});
