import { Decimal } from '@prisma/client/runtime/library';
import { allocateCashSaleByCost } from './shop-cash-sale-allocation.util';

const D = (v: string | number) => new Decimal(v);

describe('allocateCashSaleByCost', () => {
  it('single product → all revenue, its own cost', () => {
    const res = allocateCashSaleByCost(D(10000), [{ id: 'p1', costPrice: D(7000) }]);
    expect(res).toHaveLength(1);
    expect(res[0].productId).toBe('p1');
    expect(res[0].revenue.toString()).toBe('10000');
    expect(res[0].cost.toString()).toBe('7000');
  });

  it('allocates proportionally by cost; revenues sum EXACTLY to netAmount', () => {
    const res = allocateCashSaleByCost(D(1000), [
      { id: 'phone', costPrice: D(600) },
      { id: 'case', costPrice: D(400) },
    ]);
    expect(res.map((r) => r.revenue.toString())).toEqual(['600', '400']);
    expect(res.map((r) => r.cost.toString())).toEqual(['600', '400']);
    const sum = res.reduce((s, r) => s.plus(r.revenue), new Decimal(0));
    expect(sum.toString()).toBe('1000');
  });

  it('last product absorbs the rounding residual (sum stays exact)', () => {
    const res = allocateCashSaleByCost(D(1000), [
      { id: 'a', costPrice: D(1) },
      { id: 'b', costPrice: D(1) },
      { id: 'c', costPrice: D(1) },
    ]);
    // 1000 * 1/3 = 333.3333 → 333.33 each for a,b; c absorbs residual 333.34
    expect(res.map((r) => r.revenue.toString())).toEqual(['333.33', '333.33', '333.34']);
    const sum = res.reduce((s, r) => s.plus(r.revenue), new Decimal(0));
    expect(sum.toString()).toBe('1000');
  });

  it('zero total cost (give-away bundle) → all revenue on the main (first) product', () => {
    const res = allocateCashSaleByCost(D(500), [
      { id: 'main', costPrice: D(0) },
      { id: 'free', costPrice: D(0) },
    ]);
    expect(res.map((r) => r.revenue.toString())).toEqual(['500', '0']);
    expect(res.map((r) => r.cost.toString())).toEqual(['0', '0']);
  });

  it('empty products → empty allocation', () => {
    expect(allocateCashSaleByCost(D(100), [])).toEqual([]);
  });
});
