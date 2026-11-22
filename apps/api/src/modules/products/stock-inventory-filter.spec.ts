import { validateSync } from 'class-validator';
import { StockScopeQueryDto } from './dto/stock-scope-query.dto';
import { stockInventoryWhere, stockOver90Where } from './stock-inventory-filter';

describe('stock inventory predicates', () => {
  it('limits devices and accessories independently without changing the API default', () => {
    expect(stockInventoryWhere('devices')).toEqual({ category: { in: ['PHONE_NEW', 'PHONE_USED', 'TABLET'] } });
    expect(stockInventoryWhere('accessories')).toEqual({ category: 'ACCESSORY' });
    expect(stockInventoryWhere()).toEqual({});
    expect(stockInventoryWhere('all')).toEqual({});
  });
  it('uses completed days and an intake date before the creation fallback', () => {
    expect(stockOver90Where(new Date('2026-11-22T00:00:00Z'))).toEqual({ OR: [
      { stockInDate: { lte: new Date('2026-08-23T00:00:00Z') } },
      { stockInDate: null, createdAt: { lte: new Date('2026-08-23T00:00:00Z') } },
    ] });
  });
  it('rejects malformed scope query values', () => {
    for (const value of ['other', ['devices'], {}]) expect(validateSync(Object.assign(new StockScopeQueryDto(), { inventoryScope: value }))).not.toHaveLength(0);
    for (const value of [undefined, 'all', 'devices', 'accessories']) expect(validateSync(Object.assign(new StockScopeQueryDto(), { inventoryScope: value }))).toHaveLength(0);
  });
});
