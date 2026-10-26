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
        count: jest.fn(async ({ where }) => where.AND?.some((clause: Record<string, unknown>) => 'costSnapshot' in clause) ? 0 : 2),
        aggregate: jest.fn().mockResolvedValue({ _sum: { netAmount: '300', discount: '0' } }),
        groupBy: jest.fn(async ({ by }: { by: string[] }) => by[0] === 'saleType'
          ? [{ saleType: 'CASH', _count: 2, _sum: { netAmount: '300' } }]
          : [{ productId: 'p1', _count: { _all: 1 }, _sum: { netAmount: '100' } },
            { productId: 'p2', _count: { _all: 1 }, _sum: { netAmount: '200' } }]),
      },
      saleCostSnapshot: { aggregate: jest.fn().mockResolvedValue({ _sum: { mainProductCost: '110' } }) },
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
    expect(db.saleCostSnapshot.aggregate).not.toHaveBeenCalled();
  });
});

describe('Sales findOne bundle products (ใบปะหน้าพัสดุ A6)', () => {
  const owner = { id: 'owner', role: 'OWNER' };
  function fixture(bundleProductIds: string[]) {
    const db = {
      sale: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1', saleNumber: 'S-20261022-0001', bundleProductIds,
          customer: { id: 'c1', name: 'สมหญิง', phone: '0800000000', nationalId: null },
          product: { id: 'p1', name: 'iPhone 15', costPrice: '1' },
          booking: null, costSnapshot: null,
        }),
      },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'acc1', name: 'เคสใส' }, { id: 'acc2', name: 'ฟิล์มกระจก' }]) },
    };
    return { db, service: new SalesQueryService(db as unknown as PrismaService) };
  }
  it('resolves bundle product names for the label (ของแถมในกล่อง)', async () => {
    const { db, service } = fixture(['acc1', 'acc2']);
    const result = await service.findOne('s1', owner);
    expect(result.bundleProducts).toEqual([{ id: 'acc1', name: 'เคสใส' }, { id: 'acc2', name: 'ฟิล์มกระจก' }]);
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['acc1', 'acc2'] }, deletedAt: null },
      select: { id: true, name: true },
    });
  });
  it('returns [] without querying when the sale has no bundle', async () => {
    const { db, service } = fixture([]);
    const result = await service.findOne('s1', owner);
    expect(result.bundleProducts).toEqual([]);
    expect(db.product.findMany).not.toHaveBeenCalled();
  });
});
