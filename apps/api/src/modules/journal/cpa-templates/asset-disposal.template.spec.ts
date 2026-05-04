import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { AssetDisposalTemplate } from './asset-disposal.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function ensureTestAsset(opts: {
  assetCategory?: string;
  costValue?: number;
  salvageValue?: number;
  accumulatedDepre?: number;
  status?: string;
}) {
  const assetCode = `DIS-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.fixedAsset.create({
    data: {
      assetCode,
      name: `Disposal Test Asset ${assetCode}`,
      category: opts.assetCategory ?? 'OFFICE_EQUIPMENT',
      assetCategory: (opts.assetCategory ?? 'OFFICE_EQUIPMENT') as any,
      costValue: new Decimal(opts.costValue ?? 100000),
      salvageValue: new Decimal(opts.salvageValue ?? 0),
      usefulLife: 5,
      usefulLifeMonths: 60,
      purchaseDate: new Date('2024-01-01'),
      accumulatedDepre: new Decimal(opts.accumulatedDepre ?? 40000),
      depreciationAccountCode: '53-1601',
      accumulatedAccountCode: '12-2102',
      status: (opts.status ?? 'ACTIVE') as any,
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

describe('AssetDisposalTemplate', () => {
  let journal: JournalAutoService;

  beforeAll(async () => {
    journal = await setup();
  });

  it('loss case: NBV=60000, proceeds=50000 → Dr 53-1605 ขาดทุน 10000', async () => {
    // cost=100000, accumulated=40000, NBV=60000, proceeds=50000, loss=10000
    const asset = await ensureTestAsset({
      assetCategory: 'OFFICE_EQUIPMENT',
      costValue: 100000,
      accumulatedDepre: 40000,
    });

    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-04-30'),
      disposalProceeds: 50000,
      depositAccountCode: '11-1101',
    });

    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });

    expect(je).toBeDefined();
    expect(je!.status).toBe('POSTED');

    // Balanced
    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Dr accumulated dep 40000
    const accLine = je!.lines.find((l) => l.accountCode === '12-2102');
    expect(accLine).toBeDefined();
    expect(new Decimal(accLine!.debit.toString()).toFixed(2)).toBe('40000.00');

    // Dr cash 50000
    const cashLine = je!.lines.find((l) => l.accountCode === '11-1101');
    expect(cashLine).toBeDefined();
    expect(new Decimal(cashLine!.debit.toString()).toFixed(2)).toBe('50000.00');

    // Dr loss 10000
    const lossLine = je!.lines.find((l) => l.accountCode === '53-1605');
    expect(lossLine).toBeDefined();
    expect(new Decimal(lossLine!.debit.toString()).toFixed(2)).toBe('10000.00');

    // Cr asset cost 100000
    const costLine = je!.lines.find((l) => l.accountCode === '12-2101');
    expect(costLine).toBeDefined();
    expect(new Decimal(costLine!.credit.toString()).toFixed(2)).toBe('100000.00');

    // Asset status → DISPOSED
    const updated = await prisma.fixedAsset.findFirst({ where: { id: asset.id } });
    expect(updated!.status).toBe('DISPOSED');
    expect(new Decimal(updated!.disposalProceeds!.toString()).toFixed(2)).toBe('50000.00');
  });

  it('gain case: NBV=20000, proceeds=30000 → Cr 41-1102 กำไร 10000', async () => {
    // cost=100000, accumulated=80000, NBV=20000, proceeds=30000, gain=10000
    const asset = await ensureTestAsset({
      assetCategory: 'OFFICE_EQUIPMENT',
      costValue: 100000,
      accumulatedDepre: 80000,
    });

    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-04-30'),
      disposalProceeds: 30000,
      depositAccountCode: '11-1101',
    });

    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });

    // Balanced
    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Cr gain 10000 (interim account 41-1102)
    const gainLine = je!.lines.find((l) => l.accountCode === '41-1102');
    expect(gainLine).toBeDefined();
    expect(new Decimal(gainLine!.credit.toString()).toFixed(2)).toBe('10000.00');

    // No loss line
    const lossLine = je!.lines.find((l) => l.accountCode === '53-1605');
    expect(lossLine).toBeUndefined();

    const updated = await prisma.fixedAsset.findFirst({ where: { id: asset.id } });
    expect(updated!.status).toBe('DISPOSED');
  });

  it('zero proceeds write-off: Dr 53-1605 = full NBV', async () => {
    // cost=50000, accumulated=20000, NBV=30000, proceeds=0, loss=30000
    const asset = await ensureTestAsset({
      assetCategory: 'OFFICE_FURNITURE',
      costValue: 50000,
      accumulatedDepre: 20000,
    });

    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    await tmpl.execute({
      assetId: asset.id,
      disposalDate: new Date(),
      disposalProceeds: 0,
    });

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });

    const lossLine = je!.lines.find((l) => l.accountCode === '53-1605');
    expect(lossLine).toBeDefined();
    expect(new Decimal(lossLine!.debit.toString()).toFixed(2)).toBe('30000.00');

    // No cash line (proceeds=0)
    const cashLine = je!.lines.find((l) => l.accountCode === '11-1101');
    expect(cashLine).toBeUndefined();
  });

  it('throws if asset already DISPOSED', async () => {
    const asset = await ensureTestAsset({ status: 'DISPOSED' });

    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    await expect(
      tmpl.execute({ assetId: asset.id, disposalDate: new Date(), disposalProceeds: 0 }),
    ).rejects.toThrow('ถูกจำหน่ายแล้ว');
  });

  it('uses VEHICLE account codes: 12-2107 / 12-2108', async () => {
    const asset = await ensureTestAsset({
      assetCategory: 'VEHICLE',
      costValue: 500000,
      accumulatedDepre: 200000,
    });

    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    await tmpl.execute({
      assetId: asset.id,
      disposalDate: new Date(),
      disposalProceeds: 250000,
      depositAccountCode: '11-1101',
    });

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });

    // Cr asset cost 12-2107
    const costLine = je!.lines.find((l) => l.accountCode === '12-2107');
    expect(costLine).toBeDefined();

    // Dr accumulated 12-2108
    const accLine = je!.lines.find((l) => l.accountCode === '12-2108');
    expect(accLine).toBeDefined();
  });
});
