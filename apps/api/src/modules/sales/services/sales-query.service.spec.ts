import { SalesQueryService } from './sales-query.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('Sales filtered report totals', () => {
  const owner = { id: 'owner', role: 'OWNER' };
  function fixture() {
    const rows = [
      { id: 'a', netAmount: '100', customer: { id: 'customer' }, product: { id: 'p1', costPrice: '60' } },
      { id: 'b', netAmount: '200', customer: { id: 'customer' }, product: { id: 'p2', costPrice: '50' } },
    ];
    const db = {
      sale: {
        findMany: jest.fn(async ({ skip }: { skip: number }) => [rows[skip]]),
        count: jest.fn().mockResolvedValue(2),
        aggregate: jest.fn().mockResolvedValue({ _sum: { netAmount: '300', discount: '0' } }),
        groupBy: jest.fn(async ({ by }: { by: string[] }) => by[0] === 'saleType'
          ? [{ saleType: 'CASH', _count: 2, _sum: { netAmount: '300' } }]
          : [{ productId: 'p1', _count: { _all: 1 }, _sum: { netAmount: '100' } },
            { productId: 'p2', _count: { _all: 1 }, _sum: { netAmount: '200' } }]),
      },
      product: { findMany: jest.fn().mockResolvedValue(rows.map(row => row.product)) },
    };
    return { db, service: new SalesQueryService(db as unknown as PrismaService) };
  }
  it('reports profit 190 and net 300 on both pages with identical filter scope', async () => {
    const { db, service } = fixture();
    for (const page of [1, 2]) {
      const result = await service.findAll({ page, limit: 1, search: 'customer', branchId: 'branch',
        startDate: '2026-09-01', endDate: '2026-09-30' }, owner);
      expect(result.summary).toMatchObject({ totalAmount: 300, totalProfit: 190 });
    }
    const where = db.sale.findMany.mock.calls[0][0];
    for (const call of db.sale.groupBy.mock.calls) expect(call[0]).toMatchObject({ where: expect.any(Object) });
    expect(where).toMatchObject({ where: { branchId: 'branch', deletedAt: null,
      createdAt: { gte: new Date('2026-08-31T17:00:00Z'), lt: new Date('2026-09-30T17:00:00Z') },
      AND: expect.any(Array), OR: expect.any(Array) } });
  });
  it('does not aggregate costs for staff', async () => {
    const { db, service } = fixture();
    const result = await service.findAll({ page: 1 }, { id: 'staff', role: 'SALES', branchId: 'branch' });
    expect(result.summary.totalProfit).toBe(0);
    expect(db.product.findMany).not.toHaveBeenCalled();
  });
});
