import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient, AssetCategory, AssetStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { AssetInvoiceReceivedTemplate } from './asset-invoice-received.template';
import { AssetPurchaseTemplate } from './asset-purchase.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

let template: AssetInvoiceReceivedTemplate;
let purchase: AssetPurchaseTemplate;
let userId: string;

async function createPostedAssetWith11_4102(): Promise<string> {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const data: Prisma.FixedAssetUncheckedCreateInput = {
    assetCode: `INV-${Date.now()}-${rand}`,
    docNo: `ASSET-2605-${rand}`,
    name: 'Notebook with deferred VAT',
    category: 'EQUIPMENT' as AssetCategory,
    basePrice: new Decimal(10000),
    shippingCost: new Decimal(0),
    installationCost: new Decimal(0),
    otherCapitalized: new Decimal(0),
    hasVat: true,
    vatInclusive: false,
    vatAmount: new Decimal(700),
    vatAccount: '11-4102', // ← deferred input VAT
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
  };
  const asset = await prisma.fixedAsset.create({ data });

  // POST it via purchase template (creates the original JE that booked Dr 11-4102)
  await purchase.execute({ assetId: asset.id, postedById: userId });
  await prisma.fixedAsset.update({
    where: { id: asset.id },
    data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
  });
  return asset.id;
}

async function setup() {
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.depreciationEntry.deleteMany({});
  await prisma.assetTransferHistory.deleteMany({});
  await prisma.fixedAsset.deleteMany({});

  await seedFinanceCoa(prisma);

  let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }
  userId = admin.id;

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
  purchase = new AssetPurchaseTemplate(journal, prisma as any);
  return new AssetInvoiceReceivedTemplate(journal, prisma as any);
}

describe('AssetInvoiceReceivedTemplate', () => {
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

  it('posts Dr 11-4101 / Cr 11-4102 for the full VAT amount', async () => {
    const assetId = await createPostedAssetWith11_4102();
    const result = await template.execute({ assetId, triggeredById: userId });
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-invoice-received' } as any },
          { metadata: { path: ['assetId'], equals: assetId } as any },
        ],
      },
      include: { lines: true },
    });
    expect(je).toBeTruthy();
    expect(je!.status).toBe('POSTED');

    const dr = je!.lines.find((l) => new Decimal(l.debit.toString()).gt(0));
    const cr = je!.lines.find((l) => new Decimal(l.credit.toString()).gt(0));
    expect(dr!.accountCode).toBe('11-4101');
    expect(cr!.accountCode).toBe('11-4102');
    expect(new Decimal(dr!.debit.toString()).toFixed(2)).toBe('700.00');
    expect(new Decimal(cr!.credit.toString()).toFixed(2)).toBe('700.00');
  });

  it('is idempotent — second call returns the same entry without duplicating', async () => {
    const assetId = await createPostedAssetWith11_4102();
    const first = await template.execute({ assetId, triggeredById: userId });
    const second = await template.execute({ assetId, triggeredById: userId });
    expect(second.entryNo).toBe(first.entryNo);
    expect(second.journalEntryId).toBe(first.journalEntryId);

    const count = await prisma.journalEntry.count({
      where: {
        metadata: { path: ['flow'], equals: 'asset-invoice-received' } as any,
      },
    });
    expect(count).toBe(1);
  });

  it('rejects when asset.vatAccount is already 11-4101 (nothing to transfer)', async () => {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    const asset = await prisma.fixedAsset.create({
      data: {
        assetCode: `INV-${Date.now()}-${rand}`,
        docNo: `ASSET-2605-${rand}`,
        name: 'Cash-and-carry purchase',
        category: 'EQUIPMENT' as AssetCategory,
        basePrice: new Decimal(10000),
        shippingCost: new Decimal(0),
        installationCost: new Decimal(0),
        otherCapitalized: new Decimal(0),
        hasVat: true,
        vatAmount: new Decimal(700),
        vatAccount: '11-4101', // ← claimable directly, no deferred VAT
        whtAmount: new Decimal(0),
        purchaseCost: new Decimal(10000),
        residualValue: new Decimal(0),
        usefulLifeMonths: 36,
        monthlyDepr: new Decimal('277.78'),
        netBookValue: new Decimal(10000),
        purchaseDate: new Date('2026-05-01'),
        paymentAccount: '11-1201',
        status: 'POSTED' as AssetStatus,
        createdById: userId,
        postedById: userId,
        postedAt: new Date(),
      },
    });

    await expect(
      template.execute({ assetId: asset.id, triggeredById: userId }),
    ).rejects.toThrow(/11-4102/);
  });

  it('rejects when asset is not POSTED', async () => {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    const asset = await prisma.fixedAsset.create({
      data: {
        assetCode: `INV-${Date.now()}-${rand}`,
        docNo: `ASSET-2605-${rand}`,
        name: 'Draft asset',
        category: 'EQUIPMENT' as AssetCategory,
        basePrice: new Decimal(10000),
        shippingCost: new Decimal(0),
        installationCost: new Decimal(0),
        otherCapitalized: new Decimal(0),
        hasVat: true,
        vatAmount: new Decimal(700),
        vatAccount: '11-4102',
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
      },
    });

    await expect(
      template.execute({ assetId: asset.id, triggeredById: userId }),
    ).rejects.toThrow(/POSTED/);
  });

  it('rejects when VAT amount is zero (nothing to transfer)', async () => {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    const asset = await prisma.fixedAsset.create({
      data: {
        assetCode: `INV-${Date.now()}-${rand}`,
        docNo: `ASSET-2605-${rand}`,
        name: 'Zero VAT',
        category: 'EQUIPMENT' as AssetCategory,
        basePrice: new Decimal(10000),
        shippingCost: new Decimal(0),
        installationCost: new Decimal(0),
        otherCapitalized: new Decimal(0),
        hasVat: true,
        vatAmount: new Decimal(0),
        vatAccount: '11-4102',
        whtAmount: new Decimal(0),
        purchaseCost: new Decimal(10000),
        residualValue: new Decimal(0),
        usefulLifeMonths: 36,
        monthlyDepr: new Decimal('277.78'),
        netBookValue: new Decimal(10000),
        purchaseDate: new Date('2026-05-01'),
        paymentAccount: '11-1201',
        status: 'POSTED' as AssetStatus,
        createdById: userId,
        postedById: userId,
        postedAt: new Date(),
      },
    });

    await expect(
      template.execute({ assetId: asset.id, triggeredById: userId }),
    ).rejects.toThrow(/VAT amount/);
  });
});
