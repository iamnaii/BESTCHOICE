import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient, AssetCategory, AssetStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { AssetPurchaseTemplate } from './asset-purchase.template';
import { AssetPurchaseReverseTemplate } from './asset-purchase-reverse.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

let purchase: AssetPurchaseTemplate;
let reverse: AssetPurchaseReverseTemplate;
let userId: string;

async function createAsset(overrides: Partial<Prisma.FixedAssetUncheckedCreateInput> = {}) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const data: Prisma.FixedAssetUncheckedCreateInput = {
    assetCode: `TEST-${Date.now()}-${rand}`,
    docNo: `ASSET-2605-${rand}`,
    name: 'Test Notebook',
    category: 'EQUIPMENT' as AssetCategory,
    basePrice: new Decimal(10000),
    shippingCost: new Decimal(0),
    installationCost: new Decimal(0),
    otherCapitalized: new Decimal(0),
    vatAmount: new Decimal(0),
    whtAmount: new Decimal(0),
    purchaseCost: new Decimal(10000),
    residualValue: new Decimal(0),
    usefulLifeMonths: 36,
    monthlyDepr: new Decimal('277.78'),
    netBookValue: new Decimal(10000),
    purchaseDate: new Date('2026-05-01'),
    paymentAccount: '11-1201',
    status: 'DRAFT' as AssetStatus,
    createdById: userId,
    ...overrides,
  };
  return prisma.fixedAsset.create({ data });
}

async function setup() {
  // Clean accounting tables (children-first to satisfy FK constraints)
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.depreciationEntry.deleteMany({});
  await prisma.assetTransferHistory.deleteMany({});
  await prisma.fixedAsset.deleteMany({});

  await seedFinanceCoa(prisma);

  // System user — required by JournalAutoService.resolveSystemUserId
  let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }
  userId = admin.id;

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

  const journal = new JournalAutoService(prisma as any);
  return {
    purchase: new AssetPurchaseTemplate(journal, prisma as any),
    reverse: new AssetPurchaseReverseTemplate(journal, prisma as any),
  };
}

describe('AssetPurchaseReverseTemplate', () => {
  beforeAll(async () => {
    const t = await setup();
    purchase = t.purchase;
    reverse = t.reverse;
  });

  beforeEach(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.depreciationEntry.deleteMany({});
    await prisma.assetTransferHistory.deleteMany({});
    await prisma.fixedAsset.deleteMany({});
  });

  it('creates mirror JE with Cr/Dr swapped', async () => {
    const asset = await createAsset({
      basePrice: new Decimal(10000),
      hasVat: true,
      vatInclusive: false,
      vatAmount: new Decimal(700),
      vatAccount: '11-4101',
      purchaseCost: new Decimal(10000),
      netBookValue: new Decimal(10000),
    });
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'ทดสอบกลับรายการ' });

    const reversalJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-purchase-reverse' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
      include: { lines: true },
    });
    expect(reversalJe).toBeTruthy();

    const totalDr = reversalJe!.lines.reduce(
      (s, l) => s.plus(l.debit.toString()),
      new Decimal(0),
    );
    const totalCr = reversalJe!.lines.reduce(
      (s, l) => s.plus(l.credit.toString()),
      new Decimal(0),
    );
    expect(totalDr.equals(totalCr)).toBe(true);
    expect(totalDr.toFixed(2)).toBe('10700.00');

    // Mirror check: original purchase had Dr 12-2101 (10000) and Dr 11-4101 (700)
    // Reversal should have Cr 12-2101 (10000) and Cr 11-4101 (700)
    const crCost = reversalJe!.lines.find((l) => l.accountCode === '12-2101');
    expect(crCost).toBeTruthy();
    expect(new Decimal(crCost!.credit.toString()).toFixed(2)).toBe('10000.00');
    expect(new Decimal(crCost!.debit.toString()).toFixed(2)).toBe('0.00');

    const crVat = reversalJe!.lines.find((l) => l.accountCode === '11-4101');
    expect(crVat).toBeTruthy();
    expect(new Decimal(crVat!.credit.toString()).toFixed(2)).toBe('700.00');

    // And original Cr 11-1201 (10700) should now be Dr 11-1201 (10700)
    const drCash = reversalJe!.lines.find((l) => l.accountCode === '11-1201');
    expect(drCash).toBeTruthy();
    expect(new Decimal(drCash!.debit.toString()).toFixed(2)).toBe('10700.00');
    expect(new Decimal(drCash!.credit.toString()).toFixed(2)).toBe('0.00');
  });

  it('original metadata flagged reversed=true with reversedByEntryNumber', async () => {
    const asset = await createAsset();
    const r1 = await purchase.execute({ assetId: asset.id, postedById: userId });
    const r2 = await reverse.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'พิมพ์ผิด',
    });

    const original = await prisma.journalEntry.findFirst({
      where: { entryNumber: r1.entryNo },
    });
    expect(original).toBeTruthy();
    const meta = original!.metadata as any;
    expect(meta.reversed).toBe(true);
    expect(meta.reversedByEntryNumber).toBe(r2.entryNo);
    expect(meta.reversedAt).toBeTruthy();
  });

  it('rejects if asset has DepreciationEntry', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });

    await prisma.depreciationEntry.create({
      data: {
        assetId: asset.id,
        period: '2026-05',
        amount: new Decimal('277.78'),
      },
    });

    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'ลอง' }),
    ).rejects.toThrow(/depreciation/i);
  });

  it('rejects if no original purchase JE exists', async () => {
    const asset = await createAsset();
    // never call purchase.execute
    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'ลอง' }),
    ).rejects.toThrow(/not found/i);
  });

  it('idempotency: second reverse call rejects', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'ครั้งแรก' });
    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'ครั้งสอง' }),
    ).rejects.toThrow(/already reversed/i);
  });

  it('original JE remains POSTED (TFRS no-touch)', async () => {
    const asset = await createAsset();
    const r1 = await purchase.execute({ assetId: asset.id, postedById: userId });
    await reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'TFRS' });

    const original = await prisma.journalEntry.findFirst({
      where: { entryNumber: r1.entryNo },
    });
    expect(original!.status).toBe('POSTED');
  });

  it('reversal JE description includes [VOID] prefix', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'void test' });

    const reversalJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-purchase-reverse' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
      include: { lines: true },
    });
    expect(reversalJe!.description).toMatch(/ยกเลิก|VOID/i);
    for (const line of reversalJe!.lines) {
      expect(line.description ?? '').toMatch(/\[VOID\]/);
    }
  });

  it('reversal JE metadata links back to original', async () => {
    const asset = await createAsset();
    const r1 = await purchase.execute({ assetId: asset.id, postedById: userId });
    await reverse.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'reason text',
    });

    const reversalJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-purchase-reverse' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
      },
    });
    const meta = reversalJe!.metadata as any;
    expect(meta.flow).toBe('asset-purchase-reverse');
    expect(meta.originalEntryNumber).toBe(r1.entryNo);
    expect(meta.originalEntryId).toBeTruthy();
    expect(meta.reversalReason).toBe('reason text');
  });

  it('rejects if reason is empty string', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: '' }),
    ).rejects.toThrow();
  });

  it('rejects if reason is whitespace only', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: '   \t\n  ' }),
    ).rejects.toThrow();
  });

  it('writes JournalPostAuditLog for the reversal entry', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    const r2 = await reverse.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'audit log test',
    });

    const reversalJe = await prisma.journalEntry.findFirst({
      where: { entryNumber: r2.entryNo },
    });
    const auditLogs = await prisma.journalPostAuditLog.findMany({
      where: { journalEntryId: reversalJe!.id },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].postedById).toBe(userId);
  });
});
