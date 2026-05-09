import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient, AssetCategory, AssetStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { AssetPurchaseTemplate } from './asset-purchase.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

let template: AssetPurchaseTemplate;
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
  return new AssetPurchaseTemplate(journal, prisma as any);
}

describe('AssetPurchaseTemplate', () => {
  beforeAll(async () => {
    template = await setup();
  });

  beforeEach(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.assetTransferHistory.deleteMany({});
    await prisma.fixedAsset.deleteMany({});
  });

  it('posts a balanced JE for EQUIPMENT cash purchase, no VAT, no WHT', async () => {
    const asset = await createAsset();
    const result = await template.execute({ assetId: asset.id, postedById: userId });
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    expect(je).toBeTruthy();
    expect(je!.status).toBe('POSTED');

    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    expect(totalDr.toFixed(2)).toBe('10000.00');

    const dr = je!.lines.find((l) => new Decimal(l.debit.toString()).gt(0));
    expect(dr!.accountCode).toBe('12-2101');
    const cr = je!.lines.find((l) => new Decimal(l.credit.toString()).gt(0));
    expect(cr!.accountCode).toBe('11-1201');
  });

  it('routes IMPROVEMENT category to 12-2103', async () => {
    const asset = await createAsset({ category: 'IMPROVEMENT' });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    const dr = je!.lines.find((l) => new Decimal(l.debit.toString()).gt(0));
    expect(dr!.accountCode).toBe('12-2103');
  });

  it('routes FURNITURE to 12-2105 and VEHICLE to 12-2107', async () => {
    const f = await createAsset({ category: 'FURNITURE' });
    await template.execute({ assetId: f.id, postedById: userId });
    const fJe = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: f.id } } as any,
      include: { lines: true },
    });
    expect(
      fJe!.lines.find((l) => new Decimal(l.debit.toString()).gt(0))!.accountCode,
    ).toBe('12-2105');

    const v = await createAsset({ category: 'VEHICLE' });
    await template.execute({ assetId: v.id, postedById: userId });
    const vJe = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: v.id } } as any,
      include: { lines: true },
    });
    expect(
      vJe!.lines.find((l) => new Decimal(l.debit.toString()).gt(0))!.accountCode,
    ).toBe('12-2107');
  });

  it('VAT exclusive: adds Dr 11-4101 line for VAT', async () => {
    const asset = await createAsset({
      basePrice: new Decimal(10000),
      hasVat: true,
      vatInclusive: false,
      vatAmount: new Decimal(700),
      vatAccount: '11-4101',
      purchaseCost: new Decimal(10000),
      netBookValue: new Decimal(10000),
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    const vatLine = je!.lines.find((l) => l.accountCode === '11-4101');
    expect(vatLine).toBeTruthy();
    expect(new Decimal(vatLine!.debit.toString()).toFixed(2)).toBe('700.00');

    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });

  it('VAT inclusive: NO separate VAT line (already in basePrice)', async () => {
    const asset = await createAsset({
      basePrice: new Decimal(10000),
      hasVat: true,
      vatInclusive: true,
      vatAmount: new Decimal(700),
      vatAccount: '11-4101',
      purchaseCost: new Decimal(10000),
      netBookValue: new Decimal(10000),
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    expect(je!.lines.find((l) => l.accountCode === '11-4101')).toBeUndefined();
  });

  it('WHT PND53 (corporate): adds Cr 21-3103 line', async () => {
    const asset = await createAsset({
      hasWht: true,
      whtBaseAmount: new Decimal(10000),
      whtRate: new Decimal('0.03'),
      whtAmount: new Decimal(300),
      whtAccount: '21-3103',
      whtFormType: 'PND53',
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    const whtLine = je!.lines.find((l) => l.accountCode === '21-3103');
    expect(whtLine).toBeTruthy();
    expect(new Decimal(whtLine!.credit.toString()).toFixed(2)).toBe('300.00');
  });

  it('WHT PND3 (individual): routes to 21-3102', async () => {
    const asset = await createAsset({
      hasWht: true,
      whtBaseAmount: new Decimal(10000),
      whtRate: new Decimal('0.01'),
      whtAmount: new Decimal(100),
      whtAccount: '21-3102',
      whtFormType: 'PND3',
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    const whtLine = je!.lines.find((l) => l.accountCode === '21-3102');
    expect(whtLine).toBeTruthy();
    expect(new Decimal(whtLine!.credit.toString()).toFixed(2)).toBe('100.00');
  });

  it('writes account snapshot fields onto asset after POST', async () => {
    const asset = await createAsset({ category: 'EQUIPMENT' });
    await template.execute({ assetId: asset.id, postedById: userId });
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.coaCostAccount).toBe('12-2101');
    expect(updated!.coaDeprAccount).toBe('12-2102');
    expect(updated!.coaExpenseAccount).toBe('53-1601');
  });

  it('idempotency: second call returns same entry, no duplicate JE', async () => {
    const asset = await createAsset();
    const r1 = await template.execute({ assetId: asset.id, postedById: userId });
    const r2 = await template.execute({ assetId: asset.id, postedById: userId });
    expect(r1.entryNo).toBe(r2.entryNo);
    const count = await prisma.journalEntry.count({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
    });
    expect(count).toBe(1);
  });

  it('full-cost mix: basePrice + shipping + installation + other', async () => {
    const asset = await createAsset({
      basePrice: new Decimal(10000),
      shippingCost: new Decimal(500),
      installationCost: new Decimal(1000),
      otherCapitalized: new Decimal(200),
      purchaseCost: new Decimal(11700),
      netBookValue: new Decimal(11700),
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    const dr = je!.lines.find((l) => l.accountCode === '12-2101')!;
    expect(new Decimal(dr.debit.toString()).toFixed(2)).toBe('11700.00');
  });

  it('throws if asset not found', async () => {
    await expect(
      template.execute({
        assetId: '00000000-0000-0000-0000-000000000000',
        postedById: userId,
      }),
    ).rejects.toThrow();
  });

  it('inserts JournalPostAuditLog inside same transaction (T2-C14)', async () => {
    const asset = await createAsset();
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
    });
    const auditLogs = await prisma.journalPostAuditLog.findMany({
      where: { journalEntryId: je!.id },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].postedById).toBe(userId);
  });
});
