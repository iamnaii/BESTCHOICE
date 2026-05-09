import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { DepreciationService } from '../depreciation.service';
import { DepreciationTemplate } from '../../journal/cpa-templates/depreciation.template';
import { DepreciationReverseTemplate } from '../../journal/cpa-templates/depreciation-reverse.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let service: DepreciationService;
let userId: string;

beforeAll(async () => {
  // Ensure FINANCE company exists (required by JournalAutoService)
  await prisma.companyInfo.upsert({
    where: { companyCode: 'FINANCE' },
    update: {},
    create: {
      companyCode: 'FINANCE',
      nameTh: 'BESTCHOICE FINANCE',
      taxId: '0000000000001',
      address: 'TEST',
      directorName: 'ผู้อำนวยการ',
      vatRegistered: true,
    },
  });

  await seedFinanceCoa(prisma);

  let user = await prisma.user.findFirst({ where: { email: 'depr-test@bestchoice.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'depr-test@bestchoice.local',
        name: 'Depr Tester',
        password: 'x',
        role: 'OWNER',
      },
    });
  }
  userId = user.id;

  const moduleRef = await Test.createTestingModule({
    providers: [
      DepreciationService,
      DepreciationTemplate,
      DepreciationReverseTemplate,
      JournalAutoService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  service = moduleRef.get(DepreciationService);
});

afterAll(async () => {
  await prisma.depreciationEntry.deleteMany({});
  await prisma.$executeRawUnsafe(
    `ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`,
  );
  try {
    await prisma.auditLog.deleteMany({ where: { userId } });
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`,
    );
  }
  await prisma.journalPostAuditLog.deleteMany({ where: { postedById: userId } });
  await prisma.journalLine.deleteMany({
    where: { journalEntry: { createdById: userId } },
  });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.depreciationEntry.deleteMany({});
  await prisma.journalLine.deleteMany({
    where: { journalEntry: { createdById: userId } },
  });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  // Also clean stale assets from sibling test files (DEP-TEST-* prefix from
  // depreciation.template.spec.ts) that might pollute previewRun's POSTED query.
  await prisma.fixedAsset.deleteMany({
    where: { assetCode: { startsWith: 'DEP-TEST-' } },
  });
});

async function postedAsset(monthly = '833.33') {
  return prisma.fixedAsset.create({
    data: {
      assetCode: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      docNo: `ASSET-DEP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Depr Test Asset',
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(30000),
      shippingCost: new Decimal(0),
      installationCost: new Decimal(0),
      otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0),
      whtAmount: new Decimal(0),
      purchaseCost: new Decimal(30000),
      residualValue: new Decimal(0),
      usefulLifeMonths: 36,
      monthlyDepr: new Decimal(monthly),
      accumulatedDepr: new Decimal(0),
      netBookValue: new Decimal(30000),
      coaCostAccount: '12-2101',
      coaDeprAccount: '12-2102',
      coaExpenseAccount: '53-1601',
      purchaseDate: new Date('2026-01-01'),
      paymentAccount: '11-1201',
      status: 'POSTED' as AssetStatus,
      createdById: userId,
    },
  });
}

describe('DepreciationService.listRuns', () => {
  it('returns empty when no entries', async () => {
    const runs = await service.listRuns();
    expect(runs).toEqual([]);
  });

  it('aggregates entries by period with assetCount + total', async () => {
    const a = await postedAsset();
    const b = await postedAsset();
    await prisma.depreciationEntry.create({
      data: { assetId: a.id, period: '2026-05', amount: new Decimal(833.33) },
    });
    await prisma.depreciationEntry.create({
      data: { assetId: b.id, period: '2026-05', amount: new Decimal(833.33) },
    });
    const runs = await service.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].period).toBe('2026-05');
    expect(runs[0].assetCount).toBe(2);
    expect(parseFloat(runs[0].totalAmount)).toBeCloseTo(1666.66, 2);
    expect(runs[0].status).toBe('POSTED');
  });

  it('marks period REVERSED when all entries are reversed', async () => {
    const a = await postedAsset();
    await prisma.depreciationEntry.create({
      data: {
        assetId: a.id,
        period: '2026-04',
        amount: new Decimal(833.33),
        reversedAt: new Date(),
        reversedById: userId,
      },
    });
    const runs = await service.listRuns();
    expect(runs[0].status).toBe('REVERSED');
  });
});

describe('DepreciationService.previewRun', () => {
  it('returns empty preview when no eligible assets', async () => {
    const preview = await service.previewRun('2026-05');
    expect(preview.assetCount).toBe(0);
    expect(preview.lines).toEqual([]);
  });

  it('returns lines for POSTED assets not yet depreciated for the period', async () => {
    const a = await postedAsset();
    const preview = await service.previewRun('2026-05');
    expect(preview.assetCount).toBe(1);
    expect(preview.lines[0].assetId).toBe(a.id);
    expect(preview.lines[0].drAccount).toBe('53-1601');
    expect(preview.lines[0].crAccount).toBe('12-2102');
    expect(parseFloat(preview.lines[0].monthlyDepr)).toBeCloseTo(833.33, 2);
  });

  it('excludes assets already depreciated for that period (reversedAt IS NULL)', async () => {
    const a = await postedAsset();
    await prisma.depreciationEntry.create({
      data: { assetId: a.id, period: '2026-05', amount: new Decimal(833.33) },
    });
    const preview = await service.previewRun('2026-05');
    expect(preview.assetCount).toBe(0);
    expect(preview.alreadyRunForAssetIds).toContain(a.id);
  });

  it('rejects invalid period format', async () => {
    await expect(service.previewRun('2026-13')).rejects.toThrow(/YYYY-MM/);
    await expect(service.previewRun('not-a-period')).rejects.toThrow();
  });

  it('excludes fully-depreciated assets', async () => {
    const a = await postedAsset();
    await prisma.fixedAsset.update({
      where: { id: a.id },
      data: { accumulatedDepr: new Decimal(30000), netBookValue: new Decimal(0) },
    });
    const preview = await service.previewRun('2026-05');
    expect(preview.assetCount).toBe(0);
  });

  it('reuses asset.coaExpenseAccount snapshot if present (over CATEGORY_ACCOUNT_MAP)', async () => {
    const a = await postedAsset();
    await prisma.fixedAsset.update({
      where: { id: a.id },
      data: { coaExpenseAccount: '53-1602', coaDeprAccount: '12-2104' },
    });
    const preview = await service.previewRun('2026-05');
    expect(preview.lines[0].drAccount).toBe('53-1602');
    expect(preview.lines[0].crAccount).toBe('12-2104');
  });
});

describe('DepreciationService.runManual', () => {
  it('posts JE per eligible asset and inserts DepreciationEntry rows', async () => {
    const a = await postedAsset();
    const b = await postedAsset();
    const result = await service.runManual('2026-05', userId);
    expect(result.assetCount).toBe(2);
    expect(parseFloat(result.totalAmount)).toBeCloseTo(1666.66, 2);

    const entries = await prisma.depreciationEntry.findMany({ where: { period: '2026-05' } });
    expect(entries).toHaveLength(2);
    const aEntry = entries.find((e) => e.assetId === a.id)!;
    expect(parseFloat(aEntry.amount.toString())).toBeCloseTo(833.33, 2);
    expect(aEntry.journalEntryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    // accumulatedDepr updated
    const aUpdated = await prisma.fixedAsset.findUnique({ where: { id: a.id } });
    expect(parseFloat(aUpdated!.accumulatedDepr.toString())).toBeCloseTo(833.33, 2);
    const bUpdated = await prisma.fixedAsset.findUnique({ where: { id: b.id } });
    expect(parseFloat(bUpdated!.accumulatedDepr.toString())).toBeCloseTo(833.33, 2);
  });

  it('idempotent: second runManual for same period returns existing entries (no duplicates)', async () => {
    await postedAsset();
    const r1 = await service.runManual('2026-05', userId);
    const r2 = await service.runManual('2026-05', userId);
    expect(r2.assetCount).toBe(r1.assetCount);
    const entries = await prisma.depreciationEntry.findMany({ where: { period: '2026-05' } });
    expect(entries).toHaveLength(r1.assetCount);
  });

  it('rejects invalid period format', async () => {
    await expect(service.runManual('2026-13', userId)).rejects.toThrow(/YYYY-MM/);
  });

  it('rejects future period', async () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 2);
    const futurePeriod = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}`;
    await expect(service.runManual(futurePeriod, userId)).rejects.toThrow(/อนาคต|future/i);
  });

  it('writes AuditLog DEPRECIATION_RUN_MANUAL', async () => {
    await postedAsset();
    await service.runManual('2026-05', userId);
    const log = await prisma.auditLog.findFirst({
      where: { entity: 'depreciation_run', entityId: '2026-05', action: 'DEPRECIATION_RUN_MANUAL' },
    });
    expect(log).toBeTruthy();
  });

  it('V15 closed period → DEPRECIATION_RUN_MANUAL_BLOCKED audit + reject', async () => {
    const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
    if (!finance) throw new Error('FINANCE company missing');
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: finance.id, year: 2026, month: 5 } },
      update: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
      create: {
        companyId: finance.id,
        year: 2026,
        month: 5,
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: userId,
      },
    });
    await postedAsset();
    await expect(service.runManual('2026-05', userId)).rejects.toThrow(/period|งวด/i);
    const blocked = await prisma.auditLog.findFirst({
      where: {
        entity: 'depreciation_run',
        entityId: '2026-05',
        action: 'DEPRECIATION_RUN_MANUAL_BLOCKED',
      },
    });
    expect(blocked).toBeTruthy();
    await prisma.accountingPeriod.delete({
      where: { companyId_year_month: { companyId: finance.id, year: 2026, month: 5 } },
    });
  });
});

describe('DepreciationService.reverseRun', () => {
  it('reverses entries + writes AuditLog DEPRECIATION_RUN_REVERSE', async () => {
    await postedAsset();
    await service.runManual('2026-05', userId);
    const result = await service.reverseRun('2026-05', 'mistake', userId);
    expect(result.reversedCount).toBe(1);

    const log = await prisma.auditLog.findFirst({
      where: { entity: 'depreciation_run', entityId: '2026-05', action: 'DEPRECIATION_RUN_REVERSE' },
    });
    expect(log).toBeTruthy();
    expect((log!.newValue as any).reason).toBe('mistake');
  });

  it('rejects with empty/whitespace reason', async () => {
    await postedAsset();
    await service.runManual('2026-05', userId);
    await expect(service.reverseRun('2026-05', '   ', userId)).rejects.toThrow();
  });

  it('rejects invalid period format', async () => {
    await expect(service.reverseRun('2026-13', 'reason', userId)).rejects.toThrow(/YYYY-MM/);
  });

  it('V15 closed period (current date) → DEPRECIATION_RUN_REVERSE_BLOCKED audit + reject', async () => {
    const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
    if (!finance) throw new Error('FINANCE company missing');
    await postedAsset();
    await service.runManual('2026-05', userId);
    const now = new Date();
    await prisma.accountingPeriod.upsert({
      where: {
        companyId_year_month: {
          companyId: finance.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
      },
      update: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
      create: {
        companyId: finance.id,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: userId,
      },
    });
    await expect(service.reverseRun('2026-05', 'test reason', userId)).rejects.toThrow(
      /period|งวด/i,
    );
    const blocked = await prisma.auditLog.findFirst({
      where: {
        entity: 'depreciation_run',
        entityId: '2026-05',
        action: 'DEPRECIATION_RUN_REVERSE_BLOCKED',
      },
    });
    expect(blocked).toBeTruthy();
    await prisma.accountingPeriod.delete({
      where: {
        companyId_year_month: {
          companyId: finance.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
      },
    });
  });
});
