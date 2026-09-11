import { Decimal } from '@prisma/client/runtime/library';
import { AssetQueryService } from '../services/asset-query.service';

/**
 * DOC-06 (#1565) — the register's `summary` used to add up only the rows of
 * the current page while `count` reported the whole filtered set, so the stat
 * cards understated the register whenever it spanned more than one page.
 */
describe('AssetQueryService.getRegister — summary spans every matching asset', () => {
  const asset = (id: string, purchaseCost: string, purchaseDate: string) => ({
    id, assetCode: `EQ-${id}`, name: `asset ${id}`, category: 'EQUIPMENT', branchId: null, branch: null, custodian: null, location: null,
    purchaseDate: new Date(purchaseDate), purchaseCost: new Decimal(purchaseCost), residualValue: new Decimal(0), monthlyDepr: new Decimal('1000.0000'), status: 'POSTED',
  });
  const all = [asset('a', '60000.00', '2026-05-01'), asset('b', '300000.00', '2026-05-01'), asset('c', '12000.00', '2026-05-01')];
  const entries = [
    { assetId: 'a', period: '2026-07', amount: new Decimal('1019.18'), reversedAt: null },
    { assetId: 'b', period: '2026-07', amount: new Decimal('4586.30'), reversedAt: null },
    { assetId: 'c', period: '2026-07', amount: new Decimal('339.73'), reversedAt: null },
  ];
  const prisma = {
    fixedAsset: {
      findMany: jest.fn(async (args: { select?: unknown; skip?: number; take?: number }) => (args.select ? all.map((a) => ({ id: a.id, purchaseCost: a.purchaseCost })) : all.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? all.length)))),
      count: jest.fn(async () => all.length),
    },
    depreciationEntry: { findMany: jest.fn(async (args: { where: { assetId: { in: string[] } } }) => entries.filter((e) => args.where.assetId.in.includes(e.assetId))) },
  };
  const service = new AssetQueryService(prisma as never);

  it('reports the same count and totals on every page, over all matching assets', async () => {
    const page1 = await service.getRegister({ asOfDate: '2026-08-31', page: 1, limit: 1 });
    const page3 = await service.getRegister({ asOfDate: '2026-08-31', page: 3, limit: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.total).toBe(3);
    for (const page of [page1, page3]) {
      expect(page.summary).toEqual({ count: 3, totalPurchaseCost: '372000.00', totalAccumulatedDepr: '5945.21', totalNbv: '366054.79' });
    }
  });

  it('still computes the visible rows from the same depreciation set', async () => {
    const page2 = await service.getRegister({ asOfDate: '2026-08-31', page: 2, limit: 1 });
    expect(page2.data.map((row) => [row.id, row.accumulatedDeprAt, row.netBookValueAt])).toEqual([['b', '4586.30', '295413.70']]);
  });
});
