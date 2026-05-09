import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaClient, AssetCategory, AssetStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetReportsService } from '../asset-reports.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let service: AssetReportsService;
let userId: string;
// Dedicated test branch — every test asset is bound to this branch and every
// summary call passes branchId so prior dev-DB pollution can't influence
// counts/totals (per Phase 1+2 conventions).
let testBranchId: string;

beforeAll(async () => {
  await seedFinanceCoa(prisma);

  let user = await prisma.user.findFirst({
    where: { email: 'asset-reports-test@bestchoice.local' },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'asset-reports-test@bestchoice.local',
        name: 'AR Tester',
        password: 'x',
        role: 'OWNER',
      },
    });
  }
  userId = user.id;

  // Always create a fresh isolated branch for this run — name uniqueness is
  // not enforced, but we delete by id in afterAll.
  const branch = await prisma.branch.create({
    data: {
      name: `TEST_REPORTS_BRANCH_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    },
  });
  testBranchId = branch.id;

  const moduleRef = await Test.createTestingModule({
    providers: [
      AssetReportsService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  service = moduleRef.get(AssetReportsService);
});

afterAll(async () => {
  // Wipe depreciation entries scoped to this user's assets only — never
  // truncate the entire table (other test runs might be live).
  const ownAssets = await prisma.fixedAsset.findMany({
    where: { createdById: userId },
    select: { id: true },
  });
  const ownAssetIds = ownAssets.map((a) => a.id);
  if (ownAssetIds.length > 0) {
    await prisma.depreciationEntry.deleteMany({
      where: { assetId: { in: ownAssetIds } },
    });
  }
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.branch.delete({ where: { id: testBranchId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

beforeEach(async () => {
  const ownAssets = await prisma.fixedAsset.findMany({
    where: { createdById: userId },
    select: { id: true },
  });
  const ownAssetIds = ownAssets.map((a) => a.id);
  if (ownAssetIds.length > 0) {
    await prisma.depreciationEntry.deleteMany({
      where: { assetId: { in: ownAssetIds } },
    });
  }
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
});

async function makeAsset(
  overrides: Partial<Prisma.FixedAssetUncheckedCreateInput> = {},
) {
  const data: Prisma.FixedAssetUncheckedCreateInput = {
      assetCode: `RPT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      docNo: `ASSET-RPT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Report test asset',
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(10000),
      shippingCost: new Decimal(0),
      installationCost: new Decimal(0),
      otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0),
      whtAmount: new Decimal(0),
      purchaseCost: new Decimal(10000),
      residualValue: new Decimal(0),
      usefulLifeMonths: 12,
      monthlyDepr: new Decimal(833.33),
      netBookValue: new Decimal(10000),
      purchaseDate: new Date('2026-01-01'),
      paymentAccount: '11-1201',
      status: 'POSTED' as AssetStatus,
      branchId: testBranchId,
      createdById: userId,
      ...overrides,
  };
  return prisma.fixedAsset.create({ data });
}

describe('AssetReportsService.summary', () => {
  it('groupBy=category aggregates count + cost + NBV', async () => {
    await makeAsset({
      category: 'EQUIPMENT',
      purchaseCost: new Decimal(10000),
      netBookValue: new Decimal(10000),
    });
    await makeAsset({
      category: 'EQUIPMENT',
      purchaseCost: new Decimal(5000),
      netBookValue: new Decimal(5000),
    });
    await makeAsset({
      category: 'VEHICLE',
      purchaseCost: new Decimal(50000),
      netBookValue: new Decimal(50000),
    });
    const result = await service.summary({
      groupBy: 'category',
      branchId: testBranchId,
    });
    const eq = result.find((r) => r.key === 'EQUIPMENT')!;
    expect(eq).toBeTruthy();
    expect(eq.count).toBe(2);
    expect(new Decimal(eq.totalPurchaseCost).equals(15000)).toBe(true);
    expect(new Decimal(eq.totalNbv).equals(15000)).toBe(true);
    expect(eq.label).toBe('อุปกรณ์สำนักงาน');

    const ve = result.find((r) => r.key === 'VEHICLE')!;
    expect(ve.count).toBe(1);
    expect(new Decimal(ve.totalPurchaseCost).equals(50000)).toBe(true);
  });

  it('groupBy=custodian handles null custodian as ไม่ระบุ', async () => {
    await makeAsset({ custodian: 'Alice' });
    await makeAsset({ custodian: null });
    const result = await service.summary({
      groupBy: 'custodian',
      branchId: testBranchId,
    });
    const alice = result.find((r) => r.key === 'Alice');
    const unknown = result.find((r) => r.key === 'ไม่ระบุ');
    expect(alice).toBeTruthy();
    expect(alice!.count).toBe(1);
    expect(unknown).toBeTruthy();
    expect(unknown!.count).toBe(1);
    expect(unknown!.label).toBe('ไม่ระบุ');
  });

  it('groupBy=location handles null', async () => {
    await makeAsset({ location: 'HQ' });
    await makeAsset({ location: null });
    const result = await service.summary({
      groupBy: 'location',
      branchId: testBranchId,
    });
    const hq = result.find((r) => r.key === 'HQ');
    const unknown = result.find((r) => r.key === 'ไม่ระบุ');
    expect(hq).toBeTruthy();
    expect(hq!.count).toBe(1);
    expect(unknown).toBeTruthy();
    expect(unknown!.count).toBe(1);
  });

  it('asOfDate respected: subtracts depreciation entries through that period', async () => {
    const a = await makeAsset({
      category: 'EQUIPMENT',
      purchaseDate: new Date('2026-01-01'),
      monthlyDepr: new Decimal(1000),
    });
    await prisma.depreciationEntry.create({
      data: { assetId: a.id, period: '2026-01', amount: new Decimal(1000) },
    });
    await prisma.depreciationEntry.create({
      data: { assetId: a.id, period: '2026-02', amount: new Decimal(1000) },
    });
    // A 3rd entry beyond asOfDate must NOT be counted.
    await prisma.depreciationEntry.create({
      data: { assetId: a.id, period: '2026-03', amount: new Decimal(1000) },
    });
    const result = await service.summary({
      groupBy: 'category',
      asOfDate: '2026-02-15',
      branchId: testBranchId,
    });
    const eq = result.find((r) => r.key === 'EQUIPMENT')!;
    expect(eq).toBeTruthy();
    expect(new Decimal(eq.totalAccumulatedDepr).equals(2000)).toBe(true);
    expect(new Decimal(eq.totalNbv).equals(8000)).toBe(true);
  });

  it('filters by branch', async () => {
    // One asset on testBranchId, one on a different (newly created) branch.
    const otherBranch = await prisma.branch.create({
      data: {
        name: `OTHER_BRANCH_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      },
    });
    try {
      await makeAsset({ branchId: testBranchId });
      await makeAsset({ branchId: otherBranch.id });
      const result = await service.summary({
        groupBy: 'category',
        branchId: testBranchId,
      });
      const total = result.reduce((s, r) => s + r.count, 0);
      expect(total).toBe(1);
    } finally {
      await prisma.fixedAsset.deleteMany({ where: { branchId: otherBranch.id } });
      await prisma.branch
        .delete({ where: { id: otherBranch.id } })
        .catch(() => undefined);
    }
  });

  it('empty result returns array (not error)', async () => {
    const result = await service.summary({
      groupBy: 'category',
      branchId: '00000000-0000-0000-0000-000000000000',
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
