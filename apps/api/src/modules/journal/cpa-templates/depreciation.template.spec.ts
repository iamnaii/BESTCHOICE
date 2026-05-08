import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { DepreciationTemplate } from './depreciation.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

const CATEGORY_ACCOUNTS: Record<string, { cost: string; depr: string; expense: string }> = {
  EQUIPMENT: { cost: '12-2101', depr: '12-2102', expense: '53-1601' },
  IMPROVEMENT: { cost: '12-2103', depr: '12-2104', expense: '53-1602' },
  FURNITURE: { cost: '12-2105', depr: '12-2106', expense: '53-1603' },
  VEHICLE: { cost: '12-2107', depr: '12-2108', expense: '53-1604' },
};

async function ensureTestAsset(opts: {
  category?: string;
  purchaseCost?: number;
  residualValue?: number;
  usefulLifeMonths?: number;
  accumulatedDepr?: number;
}) {
  const assetCode = `DEP-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const docNo = `ASSET-DEP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cat = (opts.category ?? 'EQUIPMENT') as 'EQUIPMENT' | 'IMPROVEMENT' | 'FURNITURE' | 'VEHICLE';
  const purchaseCost = opts.purchaseCost ?? 60000;
  const residualValue = opts.residualValue ?? 0;
  const usefulLifeMonths = opts.usefulLifeMonths ?? 60;
  const monthlyDepr = (purchaseCost - residualValue) / usefulLifeMonths;
  const accumulatedDepr = opts.accumulatedDepr ?? 0;
  const netBookValue = purchaseCost - accumulatedDepr;
  const accounts = CATEGORY_ACCOUNTS[cat];

  // Need a creator user (FK created_by_id NOT NULL)
  const user = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!user) {
    throw new Error('Test setup error: admin@bestchoice.com user must exist before creating assets');
  }

  return prisma.fixedAsset.create({
    data: {
      assetCode,
      docNo,
      name: `Test Asset ${assetCode}`,
      category: cat,
      basePrice: new Decimal(purchaseCost),
      purchaseCost: new Decimal(purchaseCost),
      residualValue: new Decimal(residualValue),
      usefulLifeMonths,
      monthlyDepr: new Decimal(monthlyDepr),
      accumulatedDepr: new Decimal(accumulatedDepr),
      netBookValue: new Decimal(netBookValue),
      purchaseDate: new Date('2026-01-01'),
      coaCostAccount: accounts.cost,
      coaDeprAccount: accounts.depr,
      coaExpenseAccount: accounts.expense,
      status: 'POSTED',
      createdById: user.id,
    },
  });
}

async function setup() {
  await prisma.depreciationEntry.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.fixedAsset.deleteMany({});
  await seedFinanceCoa(prisma);

  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!existing) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return new JournalAutoService(prisma as any);
}

describe('DepreciationTemplate', () => {
  let journal: JournalAutoService;

  beforeAll(async () => {
    journal = await setup();
  });

  it('posts balanced JE for EQUIPMENT (Dr 53-1601 / Cr 12-2102)', async () => {
    // 60,000 / 60 months = 1,000/month
    const asset = await ensureTestAsset({
      category: 'EQUIPMENT',
      purchaseCost: 60000,
      residualValue: 0,
      usefulLifeMonths: 60,
    });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const result = await tmpl.execute({ assetId: asset.id, period: '2026-04' });

    expect(result).not.toBeNull();
    expect(result!.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'monthly' } } as any,
          { metadata: { path: ['assetId'], equals: asset.id } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(je).toBeDefined();
    expect(je!.status).toBe('POSTED');

    const lines = je!.lines;
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    const drLine = lines.find((l) => l.accountCode === '53-1601');
    expect(drLine).toBeDefined();
    expect(new Decimal(drLine!.debit.toString()).toFixed(2)).toBe('1000.00');

    const crLine = lines.find((l) => l.accountCode === '12-2102');
    expect(crLine).toBeDefined();
    expect(new Decimal(crLine!.credit.toString()).toFixed(2)).toBe('1000.00');

    // Asset updated
    const updated = await prisma.fixedAsset.findFirst({ where: { id: asset.id } });
    expect(new Decimal(updated!.accumulatedDepr.toString()).toFixed(2)).toBe('1000.00');
    // netBookValue must be updated alongside accumulatedDepr: 60000 - 1000 = 59000
    expect(new Decimal(updated!.netBookValue.toString()).toFixed(2)).toBe('59000.00');
  });

  it('posts correct accounts per category: VEHICLE → Dr 53-1604 / Cr 12-2108', async () => {
    const asset = await ensureTestAsset({
      category: 'VEHICLE',
      purchaseCost: 120000,
      usefulLifeMonths: 60,
    });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const result = await tmpl.execute({ assetId: asset.id, period: '2026-04' });

    expect(result).not.toBeNull();

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });

    const drLine = je!.lines.find((l) => l.accountCode === '53-1604');
    expect(drLine).toBeDefined();
    const crLine = je!.lines.find((l) => l.accountCode === '12-2108');
    expect(crLine).toBeDefined();
  });

  it('is idempotent — second call for same period returns same JE', async () => {
    const asset = await ensureTestAsset({ category: 'FURNITURE', usefulLifeMonths: 60 });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const first = await tmpl.execute({ assetId: asset.id, period: '2026-05' });
    const second = await tmpl.execute({ assetId: asset.id, period: '2026-05' });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.entryNo).toBe(second!.entryNo);

    const count = await prisma.depreciationEntry.count({
      where: { assetId: asset.id, period: '2026-05' },
    });
    expect(count).toBe(1);
  });

  it('caps final partial month to remaining depreciable base', async () => {
    // 60,000 over 60 months = 1,000/month. Start with 59,500 accumulated → remaining 500
    const asset = await ensureTestAsset({
      category: 'EQUIPMENT',
      purchaseCost: 60000,
      residualValue: 0,
      usefulLifeMonths: 60,
      accumulatedDepr: 59500,
    });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const result = await tmpl.execute({ assetId: asset.id, period: '2026-06' });

    expect(result).not.toBeNull();

    const entry = await prisma.depreciationEntry.findFirst({
      where: { assetId: asset.id, period: '2026-06' },
    });
    // Should be capped at 500, not 1000
    expect(new Decimal(entry!.amount.toString()).toFixed(2)).toBe('500.00');

    // Phase 1: fully-depreciated state is implied by accumulatedDepr >= depreciable base.
    const updated = await prisma.fixedAsset.findFirst({ where: { id: asset.id } });
    expect(new Decimal(updated!.accumulatedDepr.toString()).toFixed(2)).toBe('60000.00');
  });

  it('skips fully depreciated asset', async () => {
    const asset = await ensureTestAsset({
      category: 'IMPROVEMENT',
      purchaseCost: 30000,
      residualValue: 0,
      usefulLifeMonths: 60,
      accumulatedDepr: 30000, // fully depreciated
    });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const result = await tmpl.execute({ assetId: asset.id, period: '2026-07' });

    expect(result).toBeNull();
  });

  it('skips DISPOSED asset', async () => {
    const asset = await ensureTestAsset({ category: 'VEHICLE', usefulLifeMonths: 60 });
    await prisma.fixedAsset.update({ where: { id: asset.id }, data: { status: 'DISPOSED' } });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const result = await tmpl.execute({ assetId: asset.id, period: '2026-08' });

    expect(result).toBeNull();
  });

  it('uses usefulLifeMonths to compute monthly depreciation', async () => {
    // usefulLifeMonths=12 on 60,000 cost → 5,000/month
    const asset = await ensureTestAsset({
      category: 'EQUIPMENT',
      purchaseCost: 60000,
      usefulLifeMonths: 12,
    });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    await tmpl.execute({ assetId: asset.id, period: '2026-09' });

    const entry = await prisma.depreciationEntry.findFirst({
      where: { assetId: asset.id, period: '2026-09' },
    });
    expect(new Decimal(entry!.amount.toString()).toFixed(2)).toBe('5000.00');
  });
});
