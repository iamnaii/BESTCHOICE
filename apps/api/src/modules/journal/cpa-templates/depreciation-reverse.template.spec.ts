import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DepreciationTemplate } from './depreciation.template';
import { DepreciationReverseTemplate } from './depreciation-reverse.template';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
const journalAuto = new JournalAutoService(prisma as unknown as PrismaService);
const depr = new DepreciationTemplate(journalAuto, prisma as unknown as PrismaService);
const reverseDepr = new DepreciationReverseTemplate(
  journalAuto,
  prisma as unknown as PrismaService,
);
let userId: string;

beforeAll(async () => {
  await seedFinanceCoa(prisma);

  // FINANCE company — required by JournalAutoService.resolveFinanceCompanyId
  const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!finance) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000002',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: new Decimal('0.0700'),
      },
    });
  }

  let user = await prisma.user.findFirst({
    where: { email: 'depr-rev-test@bestchoice.local' },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'depr-rev-test@bestchoice.local',
        name: 'Depr Rev Tester',
        password: 'x',
        role: 'OWNER',
      },
    });
  }
  userId = user.id;
});

afterAll(async () => {
  await prisma.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
  try {
    await prisma.auditLog.deleteMany({ where: { userId } });
  } finally {
    await prisma.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`;
  }
  await prisma.journalPostAuditLog.deleteMany({ where: { postedById: userId } });
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.depreciationEntry.deleteMany({});
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.journalPostAuditLog.deleteMany({ where: { postedById: userId } });
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.depreciationEntry.deleteMany({});
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
});

async function postedAsset() {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return prisma.fixedAsset.create({
    data: {
      assetCode: `TEST-${Date.now()}-${rand}`,
      docNo: `ASSET-DR-${rand}`,
      name: 'Asset',
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
      monthlyDepr: new Decimal('833.33'),
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

describe('DepreciationReverseTemplate', () => {
  it('reverses single-asset depreciation: rolls back accumulatedDepr + recomputes NBV', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    const beforeReverse = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    // Daily: 30000/((36/12)×365)=27.3973/day × 31 (May) = 849.32
    expect(new Decimal(beforeReverse!.accumulatedDepr.toString()).toFixed(2)).toBe('849.32');

    const result = await reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' });
    expect(result.reversedCount).toBe(1);

    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(new Decimal(updated!.accumulatedDepr.toString()).toFixed(2)).toBe('0.00');
    expect(new Decimal(updated!.netBookValue.toString()).toFixed(2)).toBe('30000.00');

    const entry = await prisma.depreciationEntry.findFirst({
      where: { assetId: asset.id, period: '2026-05' },
    });
    expect(entry!.reversedAt).not.toBeNull();
    expect(entry!.reversedById).toBe(userId);
  });

  it('reverses multi-asset depreciation in single run', async () => {
    const a = await postedAsset();
    const b = await postedAsset();
    await depr.execute({ assetId: a.id, period: '2026-05' });
    await depr.execute({ assetId: b.id, period: '2026-05' });
    const result = await reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' });
    expect(result.reversedCount).toBe(2);
    const entries = await prisma.depreciationEntry.findMany({ where: { period: '2026-05' } });
    expect(entries.every((e) => e.reversedAt !== null)).toBe(true);
  });

  it('original JEs remain POSTED with metadata.reversed=true', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' });
    const original = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'depreciation' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
    });
    expect(original!.status).toBe('POSTED');
    expect((original!.metadata as any).reversed).toBe(true);
  });

  it('reversal JEs created with metadata.flow=depreciation-reverse', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' });
    const reversals = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'depreciation-reverse' } as any },
          { metadata: { path: ['reversedAssetId'], equals: asset.id } as any },
        ],
      },
    });
    expect(reversals).toHaveLength(1);
    expect((reversals[0].metadata as any).period).toBe('2026-05');
    expect((reversals[0].metadata as any).reversedAssetId).toBe(asset.id);
  });

  it('rejects when no DepreciationEntry exists for period', async () => {
    await expect(
      reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' }),
    ).rejects.toThrow(/not found|ไม่พบ/i);
  });

  it('skips entries already reversed (idempotent)', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' });
    await expect(
      reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' }),
    ).rejects.toThrow(/all entries already reversed|ไม่พบ/i);
  });

  it('rejects if a later period has unreversed entries', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await depr.execute({ assetId: asset.id, period: '2026-06' });
    await expect(
      reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' }),
    ).rejects.toThrow(/หลังจากนี้|later/i);
  });

  it('reversal lines are mirrors of originals (Dr↔Cr swap, [VOID] prefix)', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'test' });
    const reversal = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['flow'], equals: 'depreciation-reverse' } as any },
      include: { lines: true },
    });
    expect(reversal!.lines.every((l) => (l.description ?? '').includes('[VOID]'))).toBe(true);
    const totalDr = reversal!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = reversal!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.equals(totalCr)).toBe(true);
  });

  it('reason propagates to reversal JE metadata', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId, reason: 'mistake in depreciation' });
    const reversal = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'depreciation-reverse' } as any },
          { metadata: { path: ['reversedAssetId'], equals: asset.id } as any },
        ],
      },
    });
    expect((reversal!.metadata as any).reversalReason).toBe('mistake in depreciation');
  });
});
