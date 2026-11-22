import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import type { PrismaService } from '../../../../prisma/prisma.service';
import { StockTransferService } from '../stock-transfer.service';
import { StockOverviewService } from '../stock-overview.service';
import { findStockGroups } from '../../products-stock-groups';
import { productInclude } from '../../products.service';

const url = process.env.DATABASE_URL ?? '';
if (
  !/^postgresql:\/\/vitest@localhost:\d+\/bc_vitest_test\?host=\/tmp\/bc-vitest-db\.[^/]+\/socket&schema=public$/.test(
    url,
  )
)
  throw Error('Use isolated tools/test-db-vitest.sh');
const db = new PrismaClient({ datasources: { db: { url } } });
const service = new StockOverviewService(db as unknown as PrismaService);
const now = new Date('2026-11-22T00:00:00Z');
let branchId: string;
beforeAll(async () => {
  branchId = (await db.branch.create({ data: { name: 'Scope fixture ' + randomUUID() } })).id;
  const day = (n: number) => new Date(now.getTime() - n * 86400000);
  await db.product.createMany({
    data: Array.from({ length: 652 }, (_, i) => ({
      name: i < 43 ? 'Fixture phone' : 'Fixture case',
      brand: 'Fixture',
      model: i < 43 ? 'Phone' : 'Case',
      category: i < 43 ? ('PHONE_USED' as const) : ('ACCESSORY' as const),
      branchId,
      costPrice: i < 43 ? 100 : 10,
      cashPrice: i < 43 ? 150 : 0,
      status: (i >= 40 && i < 43) || i === 651 ? ('QC_PENDING' as const) : ('IN_STOCK' as const),
      stockInDate: day(i < 2 || (i >= 43 && i < 127) ? 91 : i === 2 ? 90.999 : 8),
      createdAt: day(200),
    })),
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterAll(async () => {
  vi.useRealTimers();
  await db.$disconnect();
});
it('filters every ready aggregate and QC count without treating free gifts as unavailable', async () => {
  const devices = await (service.getStockDashboard as any)(branchId, 'devices');
  expect(devices.stockTurnover.currentStock).toBe(40);
  expect(devices.actionRequired).toMatchObject({ qcPending: 3, agingOver90: 2 });
  expect(devices.stockAging.reduce((n: number, b: any) => n + b.count, 0)).toBe(40);
  expect(devices.byCategory).toEqual([{ name: 'PHONE_USED', count: 40, value: 4000 }]);
  const accessories = await (service.getStockDashboard as any)(branchId, 'accessories');
  expect(accessories.stockTurnover.currentStock).toBe(608);
  expect(accessories.actionRequired).toMatchObject({ qcPending: 1, agingOver90: 84 });
  const all = await service.getStockDashboard(branchId);
  expect(all.stockTurnover.currentStock).toBe(648);
  expect(all.actionRequired.agingOver90).toBe(86);
});
it('keeps branch summary, grouped units and over90 drilldown consistent before pagination', async () => {
  const summary = await service.getStock({ branchId, inventoryScope: 'devices' } as any);
  expect(summary.summary.find((b) => b.branch.id === branchId)).toMatchObject({
    total: 43,
    inStock: 40,
    totalValue: 4000,
  });
  const list = (filters: object) =>
    findStockGroups(
      db as unknown as PrismaService,
      { branchId, groupAccessories: true, ...filters },
      productInclude,
    );
  const accessories: any = await list({
    inventoryScope: 'accessories',
    status: 'IN_STOCK',
    limit: 1,
  });
  expect(accessories.total).toBe(1);
  expect(accessories.totalUnits).toBe(608);
  expect(accessories.unitCounts).toEqual({ ready: 608, all: 609 });
  const old: any = await list({
    inventoryScope: 'devices',
    status: 'IN_STOCK',
    aging: 'over90',
    limit: 1,
  });
  expect(old.totalUnits).toBe(2);
  expect(old.data).toHaveLength(1);
  const contradictory: any = await list({ inventoryScope: 'devices', category: 'ACCESSORY' });
  expect(contradictory.totalUnits).toBe(0);
});

it('excludes deleted and zero selling prices from margin without excluding gifts from stock', async () => {
  const units = await db.product.findMany({
    where: { branchId, category: 'ACCESSORY', status: 'IN_STOCK' },
    take: 3,
  });
  await db.productPrice.createMany({
    data: units.map((p, i) => ({
      productId: p.id,
      label: 'Cash',
      isDefault: true,
      amount: i === 0 ? 0 : 30,
      deletedAt: i === 1 ? now : null,
    })),
  });
  const result = await service.getStockDashboard(branchId, 'accessories');
  expect(result.stockTurnover.currentStock).toBe(608);
  expect(result.marginOverview).toMatchObject({ itemsWithPrice: 1, totalCost: 10, totalSell: 30 });
});

it('matches destination-scoped pending counts and category/branch warranty rows', async () => {
  const other = await db.branch.create({ data: { name: randomUUID() } });
  const phone = await db.product.findFirstOrThrow({
    where: { branchId, category: 'PHONE_USED', status: 'IN_STOCK' },
  });
  const gift = await db.product.findFirstOrThrow({
    where: { branchId, category: 'ACCESSORY', status: 'IN_STOCK' },
  });
  const removed = await db.product.create({
    data: {
      branchId,
      name: 'Deleted',
      brand: 'TEST',
      model: 'TEST',
      category: 'PHONE_USED',
      costPrice: 1,
      deletedAt: now,
    },
  });
  await db.product.updateMany({
    where: { id: { in: [phone.id, gift.id] } },
    data: { warrantyExpired: false, warrantyExpireDate: new Date(now.getTime() + 86400000) },
  });
  await db.stockTransfer.createMany({
    data: [
      { productId: phone.id, toBranchId: branchId },
      { productId: gift.id, toBranchId: branchId },
      { productId: phone.id, toBranchId: other.id },
      { productId: removed.id, toBranchId: branchId },
      { productId: phone.id, toBranchId: branchId, deletedAt: now },
    ].map((r) => ({ ...r, fromBranchId: other.id, transferredBy: 'fixture' })),
  });
  const transfers = new StockTransferService(db as unknown as PrismaService);
  for (const scope of ['devices', 'accessories', 'all'] as const) {
    const rows = await transfers.getPendingTransfers(branchId, scope);
    const dashboard = await service.getStockDashboard(branchId, scope);
    expect(rows.length).toBe(scope === 'all' ? 2 : 1);
    expect(dashboard.actionRequired.pendingTransfers).toBe(rows.length);
  }
  expect((await service.getWarrantyExpiring(30, branchId, 'devices')).map((p) => p.id)).toEqual([
    phone.id,
  ]);
  expect((await service.getWarrantyExpiring(30, branchId, 'accessories')).map((p) => p.id)).toEqual(
    [gift.id],
  );
  expect(await service.getWarrantyExpiring(30, other.id, 'all')).toEqual([]);
});

it('uses the Bangkok six-month intake boundary and leaves zero-cost percentage undefined', async () => {
  const b = await db.branch.create({ data: { name: randomUUID() } });
  await db.product.create({
    data: {
      branchId: b.id,
      name: 'Boundary',
      brand: 'TEST',
      model: 'TEST',
      category: 'PHONE_NEW',
      costPrice: 0,
      createdAt: new Date('2026-06-01T00:30:00+07:00'),
      prices: { create: { label: 'Cash', amount: 100, isDefault: true } },
    },
  });
  const dashboard = await service.getStockDashboard(b.id, 'devices');
  expect(dashboard.stockMovement[0]).toMatchObject({ month: '2026-06', in: 1 });
  expect(dashboard.marginOverview.avgMarginPct).toBeNull();
});
