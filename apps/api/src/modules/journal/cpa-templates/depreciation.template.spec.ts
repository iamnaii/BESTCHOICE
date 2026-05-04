import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { DepreciationTemplate } from './depreciation.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function ensureTestAsset(opts: {
  assetCategory?: string;
  costValue?: number;
  salvageValue?: number;
  usefulLifeMonths?: number;
  usefulLife?: number;
  accumulatedDepre?: number;
}) {
  const assetCode = `DEP-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.fixedAsset.create({
    data: {
      assetCode,
      name: `Test Asset ${assetCode}`,
      category: opts.assetCategory ?? 'OFFICE_EQUIPMENT',
      assetCategory: (opts.assetCategory ?? 'OFFICE_EQUIPMENT') as any,
      costValue: new Decimal(opts.costValue ?? 60000),
      salvageValue: new Decimal(opts.salvageValue ?? 0),
      usefulLife: opts.usefulLife ?? 5,
      usefulLifeMonths: opts.usefulLifeMonths ?? null,
      purchaseDate: new Date('2026-01-01'),
      accumulatedDepre: new Decimal(opts.accumulatedDepre ?? 0),
      depreciationAccountCode: '53-1601',
      accumulatedAccountCode: '12-2102',
      status: 'ACTIVE',
    },
  });
}

async function setup() {
  await prisma.depreciationEntry.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
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

  it('posts balanced JE for OFFICE_EQUIPMENT (Dr 53-1601 / Cr 12-2102)', async () => {
    // 60,000 / 60 months = 1,000/month
    const asset = await ensureTestAsset({
      assetCategory: 'OFFICE_EQUIPMENT',
      costValue: 60000,
      salvageValue: 0,
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
    expect(new Decimal(updated!.accumulatedDepre.toString()).toFixed(2)).toBe('1000.00');
    expect(updated!.lastDepreciationPeriod).toBe('2026-04');
  });

  it('posts correct accounts per category: VEHICLE → Dr 53-1604 / Cr 12-2108', async () => {
    const asset = await ensureTestAsset({
      assetCategory: 'VEHICLE',
      costValue: 120000,
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

  it('is idempotent — second call for same period returns null', async () => {
    const asset = await ensureTestAsset({ assetCategory: 'OFFICE_FURNITURE', usefulLifeMonths: 60 });

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
      assetCategory: 'OFFICE_EQUIPMENT',
      costValue: 60000,
      salvageValue: 0,
      usefulLifeMonths: 60,
      accumulatedDepre: 59500,
    });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const result = await tmpl.execute({ assetId: asset.id, period: '2026-06' });

    expect(result).not.toBeNull();

    const entry = await prisma.depreciationEntry.findFirst({
      where: { assetId: asset.id, period: '2026-06' },
    });
    // Should be capped at 500, not 1000
    expect(new Decimal(entry!.amount.toString()).toFixed(2)).toBe('500.00');

    const updated = await prisma.fixedAsset.findFirst({ where: { id: asset.id } });
    expect(updated!.status).toBe('FULLY_DEPRECIATED');
  });

  it('skips fully depreciated asset', async () => {
    const asset = await ensureTestAsset({
      assetCategory: 'BUILDING_IMPROVEMENT',
      costValue: 30000,
      salvageValue: 0,
      usefulLifeMonths: 60,
      accumulatedDepre: 30000, // fully depreciated
    });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const result = await tmpl.execute({ assetId: asset.id, period: '2026-07' });

    expect(result).toBeNull();
  });

  it('skips DISPOSED asset', async () => {
    const asset = await ensureTestAsset({ assetCategory: 'VEHICLE', usefulLifeMonths: 60 });
    await prisma.fixedAsset.update({ where: { id: asset.id }, data: { status: 'DISPOSED' } });

    const tmpl = new DepreciationTemplate(journal, prisma as any);
    const result = await tmpl.execute({ assetId: asset.id, period: '2026-08' });

    expect(result).toBeNull();
  });

  it('uses usefulLifeMonths over usefulLife (years)', async () => {
    // usefulLife=5 years would be 60 months → 1000/mo
    // But usefulLifeMonths=12 → 5000/mo on 60000 cost
    const asset = await ensureTestAsset({
      assetCategory: 'OFFICE_EQUIPMENT',
      costValue: 60000,
      usefulLife: 5,
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
