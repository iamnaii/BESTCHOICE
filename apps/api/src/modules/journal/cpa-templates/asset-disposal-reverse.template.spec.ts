import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, AssetCategory, AssetStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetPurchaseTemplate } from './asset-purchase.template';
import { AssetDisposalTemplate } from './asset-disposal.template';
import { AssetDisposalReverseTemplate } from './asset-disposal-reverse.template';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
const journalAuto = new JournalAutoService(prisma as unknown as PrismaService);
const purchase = new AssetPurchaseTemplate(journalAuto, prisma as unknown as PrismaService);
const disposal = new AssetDisposalTemplate(journalAuto, prisma as unknown as PrismaService);
const reverseDisposal = new AssetDisposalReverseTemplate(
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
    where: { email: 'asset-disp-rev-test@bestchoice.local' },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'asset-disp-rev-test@bestchoice.local',
        name: 'Disposal Reverse Tester',
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
  await prisma.assetTransferHistory.deleteMany({});
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

async function postedAsset(overrides: Partial<Prisma.FixedAssetUncheckedCreateInput> = {}) {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const asset = await prisma.fixedAsset.create({
    data: {
      assetCode: `TEST-${Date.now()}-${rand}`,
      docNo: `ASSET-DISP-${rand}`,
      name: 'Test Asset',
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
      accumulatedDepr: new Decimal(10000),
      netBookValue: new Decimal(20000),
      coaCostAccount: '12-2101',
      coaDeprAccount: '12-2102',
      coaExpenseAccount: '53-1601',
      purchaseDate: new Date('2026-01-01'),
      paymentAccount: '11-1201',
      status: 'POSTED' as AssetStatus,
      createdById: userId,
      ...overrides,
    },
  });
  await purchase.execute({ assetId: asset.id, postedById: userId });
  return asset;
}

describe('AssetDisposalReverseTemplate', () => {
  it('creates mirror JE for SALE disposal and restores asset to POSTED', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-05-09'),
      disposalProceeds: 25000,
      depositAccountCode: '11-1201',
    });
    const result = await reverseDisposal.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'ลูกค้าคืนสินค้า',
    });
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.status).toBe('POSTED');
    expect(updated!.disposalDate).toBeNull();
    expect(new Decimal(updated!.netBookValue.toString()).toFixed(2)).toBe('20000.00');

    const reversal = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-disposal-reverse' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
      include: { lines: true },
    });
    expect(reversal).toBeTruthy();
    const totalDr = reversal!.lines.reduce(
      (s, l) => s.plus(l.debit.toString()),
      new Decimal(0),
    );
    const totalCr = reversal!.lines.reduce(
      (s, l) => s.plus(l.credit.toString()),
      new Decimal(0),
    );
    expect(totalDr.equals(totalCr)).toBe(true);
  });

  it('creates mirror JE for WRITE_OFF disposal', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-05-09'),
      disposalProceeds: 0,
    });
    await reverseDisposal.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'ทิ้งผิด',
    });
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.status).toBe('POSTED');
    expect(updated!.disposalDate).toBeNull();
    expect(new Decimal(updated!.netBookValue.toString()).toFixed(2)).toBe('20000.00');
  });

  it('rejects if no original disposal JE exists', async () => {
    const asset = await postedAsset();
    await expect(
      reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects on second call (idempotency)', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-05-09'),
      disposalProceeds: 25000,
      depositAccountCode: '11-1201',
    });
    await reverseDisposal.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'first',
    });
    await expect(
      reverseDisposal.execute({
        assetId: asset.id,
        reversedById: userId,
        reason: 'second',
      }),
    ).rejects.toThrow(/already reversed/i);
  });

  it('original disposal JE remains POSTED with metadata.reversed=true', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-05-09'),
      disposalProceeds: 25000,
      depositAccountCode: '11-1201',
    });
    await reverseDisposal.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'x',
    });
    const original = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-disposal' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
    });
    expect(original!.status).toBe('POSTED');
    expect((original!.metadata as any).reversed).toBe(true);
    expect((original!.metadata as any).reversedByEntryNumber).toMatch(/^JE-\d{6}-\d{5}$/);
  });

  it('reversal JE description prefixed with [VOID] / ยกเลิก', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-05-09'),
      disposalProceeds: 25000,
      depositAccountCode: '11-1201',
    });
    await reverseDisposal.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'x',
    });
    const reversal = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-disposal-reverse' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
      include: { lines: true },
    });
    expect(reversal!.description).toMatch(/ยกเลิก|VOID/i);
    expect(reversal!.lines.every((l) => (l.description ?? '').includes('[VOID]'))).toBe(true);
  });

  it('reversal JE metadata links back to original', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-05-09'),
      disposalProceeds: 25000,
      depositAccountCode: '11-1201',
    });
    const original = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-disposal' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
    });
    await reverseDisposal.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'ลูกค้าคืน',
    });
    const reversal = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-disposal-reverse' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
    });
    const meta = reversal!.metadata as any;
    expect(meta.flow).toBe('asset-disposal-reverse');
    expect(meta.originalEntryId).toBe(original!.id);
    expect(meta.originalEntryNumber).toBe(original!.entryNumber);
    expect(meta.reversalReason).toBe('ลูกค้าคืน');
  });

  it('rejects if reason is empty/whitespace', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-05-09'),
      disposalProceeds: 25000,
      depositAccountCode: '11-1201',
    });
    await expect(
      reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: '   ' }),
    ).rejects.toThrow();
  });
});
