import { describe, expect, it } from 'vitest';
import { buildStockColumns, stockTableMinWidth } from '../stockColumns';

// Fixed-width sortable headers are nowrap (Task 2): the width must fit text + gap-1 (4) + 14px arrow + px-2 (16).
// Measured text widths (12px / 600 / uppercase / tracking-wider, Noto Sans Thai):
// ราคาเต็มจำนวน 84.6 · ยอดผ่อนต่อเดือน 90.8 · คงเหลือ 42.3  → need ≥ text + 34.
const MIN: Record<string, number> = { cashPrice: 119, monthlyPayment: 125, quantity: 77 };

function columns(filterCategory: string) {
  return buildStockColumns({
    isManager: true,
    view: 'all',
    filterCategory,
    listProducts: [],
    selectableProducts: [],
    selectedIds: new Set(),
    toggleSelectAll: () => {},
    toggleSelect: () => {},
    navigateToProduct: () => {},
    openPriceEdit: () => {},
    setAccessoryGroupId: () => {},
    installments: new Map(),
  } as unknown as Parameters<typeof buildStockColumns>[0]);
}

describe('stockColumns fixed widths fit nowrap sort headers', () => {
  const cols = columns('');
  it.each(Object.entries(MIN))('%s is wide enough for text + arrow', (key, min) => {
    const col = cols.find((c) => c.key === key);
    expect(col).toBeDefined();
    expect(parseInt(col!.width ?? '0', 10)).toBeGreaterThanOrEqual(min);
  });
  it('pins the chosen widths', () => {
    const w = (k: string) => cols.find((c) => c.key === k)?.width;
    expect([w('cashPrice'), w('monthlyPayment'), w('quantity')]).toEqual(['120px', '128px', '80px']);
  });
  it('accessory view keeps the cashPrice column at the same width', () => {
    expect(columns('ACCESSORY').find((c) => c.key === 'cashPrice')?.width).toBe('120px');
  });
  it('table min width still sums the declared widths', () => {
    const list = columns('').filter((c) => !c.desktopHidden);
    expect(stockTableMinWidth(columns(''))).toBe(
      list.reduce((s, c) => s + (c.width ? parseInt(c.width, 10) : 140), 0),
    );
  });
});
