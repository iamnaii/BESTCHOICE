import { describe, expect, it } from 'vitest';
import { isStockInventoryScope } from './stock-inventory-scope';

describe('inventory scope input', () => {
  it('accepts only one supported scalar choice', () => {
    for (const value of ['devices', 'accessories', 'all']) expect(isStockInventoryScope(value)).toBe(true);
    for (const value of [undefined, null, '', 'ready', ['devices'], { value: 'devices' }]) expect(isStockInventoryScope(value)).toBe(false);
  });
});
