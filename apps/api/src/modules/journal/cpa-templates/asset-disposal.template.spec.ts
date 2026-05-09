import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { AssetDisposalTemplate } from './asset-disposal.template';
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
  accumulatedDepr?: number;
  status?: string;
}) {
  const assetCode = `DIS-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const docNo = `ASSET-DIS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cat = (opts.category ?? 'EQUIPMENT') as 'EQUIPMENT' | 'IMPROVEMENT' | 'FURNITURE' | 'VEHICLE';
  const purchaseCost = opts.purchaseCost ?? 100000;
  const residualValue = opts.residualValue ?? 0;
  const accumulatedDepr = opts.accumulatedDepr ?? 40000;
  const usefulLifeMonths = 60;
  const monthlyDepr = (purchaseCost - residualValue) / usefulLifeMonths;
  const netBookValue = purchaseCost - accumulatedDepr;
  const accounts = CATEGORY_ACCOUNTS[cat];

  const user = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!user) {
    throw new Error('Test setup error: admin@bestchoice.com user must exist before creating assets');
  }

  return prisma.fixedAsset.create({
    data: {
      assetCode,
      docNo,
      name: `Disposal Test Asset ${assetCode}`,
      category: cat,
      basePrice: new Decimal(purchaseCost),
      purchaseCost: new Decimal(purchaseCost),
      residualValue: new Decimal(residualValue),
      usefulLifeMonths,
      monthlyDepr: new Decimal(monthlyDepr),
      accumulatedDepr: new Decimal(accumulatedDepr),
      netBookValue: new Decimal(netBookValue),
      purchaseDate: new Date('2024-01-01'),
      coaCostAccount: accounts.cost,
      coaDeprAccount: accounts.depr,
      coaExpenseAccount: accounts.expense,
      status: (opts.status ?? 'POSTED') as any,
      createdById: user.id,
    },
  });
}

async function setup() {
  // Order matters — child tables before parents.
  await prisma.depreciationEntry.deleteMany({});
  await prisma.assetTransferHistory.deleteMany({});
  await prisma.journalPostAuditLog.deleteMany({});
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

describe('AssetDisposalTemplate', () => {
  let journal: JournalAutoService;

  beforeAll(async () => {
    journal = await setup();
  });

  it('loss case: NBV=60000, proceeds=50000 → Dr 53-1605 ขาดทุน 10000', async () => {
    // cost=100000, accumulated=40000, NBV=60000, proceeds=50000, loss=10000
    const asset = await ensureTestAsset({
      category: 'EQUIPMENT',
      purchaseCost: 100000,
      accumulatedDepr: 40000,
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
    expect(updated!.disposalDate).toBeDefined();
  });

  it('gain case: NBV=20000, proceeds=30000 → Cr 42-1105 กำไร 10000', async () => {
    // cost=100000, accumulated=80000, NBV=20000, proceeds=30000, gain=10000
    const asset = await ensureTestAsset({
      category: 'EQUIPMENT',
      purchaseCost: 100000,
      accumulatedDepr: 80000,
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

    // Cr gain 10000 (account 42-1105 — กำไรจากการจำหน่ายสินทรัพย์)
    const gainLine = je!.lines.find((l) => l.accountCode === '42-1105');
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
      category: 'FURNITURE',
      purchaseCost: 50000,
      accumulatedDepr: 20000,
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
      category: 'VEHICLE',
      purchaseCost: 500000,
      accumulatedDepr: 200000,
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

  // ─── CRITICAL #3 — VAT on disposal (ม.77/1 + ม.82) ─────────────────────────

  it('VAT on disposal: issueTaxInvoice=true → Cr 21-2101 7% + Cr cash = proceeds × 1.07', async () => {
    // Asset NBV = 30,000.08 (cost 50,000 - accumDepr 19,999.92)
    // Sale price (excl VAT) = 40,000 → gain 9,999.92
    // VAT 7% × 40,000 = 2,800 → totalCash = 42,800
    const asset = await ensureTestAsset({
      category: 'EQUIPMENT',
      purchaseCost: 50000,
      accumulatedDepr: 19999.92,
    });

    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    await tmpl.execute({
      assetId: asset.id,
      disposalDate: new Date(),
      disposalProceeds: 40000,
      depositAccountCode: '11-1201',
      issueTaxInvoice: true,
    });

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    const lines = je!.lines;

    // Balanced
    const drSum = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const crSum = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));

    // Cr 21-2101 = 2,800
    const vatLine = lines.find((l) => l.accountCode === '21-2101');
    expect(vatLine, 'Cr 21-2101 VAT output line missing on issueTaxInvoice=true').toBeDefined();
    expect(new Decimal(vatLine!.credit.toString()).toFixed(2)).toBe('2800.00');

    // Cr 12-2101 = 50,000 (asset cost, no VAT)
    const costLine = lines.find((l) => l.accountCode === '12-2101');
    expect(new Decimal(costLine!.credit.toString()).toFixed(2)).toBe('50000.00');

    // Dr 11-1201 = 42,800 (proceeds + VAT)
    const cashLine = lines.find((l) => l.accountCode === '11-1201');
    expect(new Decimal(cashLine!.debit.toString()).toFixed(2)).toBe('42800.00');

    // Cr 42-1105 = 9,999.92 (gain on disposal — unchanged by VAT)
    const gainLine = lines.find((l) => l.accountCode === '42-1105');
    expect(new Decimal(gainLine!.credit.toString()).toFixed(2)).toBe('9999.92');

    // metadata records VAT bookkeeping
    const meta = je!.metadata as Record<string, unknown>;
    expect(meta.issueTaxInvoice).toBe(true);
    expect(meta.vatOnSale).toBe('2800.00');
    expect(meta.totalCashReceived).toBe('42800.00');
  });

  it('VAT on disposal: issueTaxInvoice=false (default) → no 21-2101 line', async () => {
    const asset = await ensureTestAsset({ purchaseCost: 50000, accumulatedDepr: 19999.92 });

    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    await tmpl.execute({
      assetId: asset.id,
      disposalDate: new Date(),
      disposalProceeds: 40000,
      depositAccountCode: '11-1201',
      // issueTaxInvoice omitted — defaults to false
    });

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    expect(je!.lines.find((l) => l.accountCode === '21-2101')).toBeUndefined();
    const cashLine = je!.lines.find((l) => l.accountCode === '11-1201');
    expect(new Decimal(cashLine!.debit.toString()).toFixed(2)).toBe('40000.00');
  });

  it('VAT on disposal: loss case + tax invoice → 21-2101 + 53-1605 both posted', async () => {
    // NBV = 30,000.08 (cost 50k - accumDepr 19,999.92)
    // Sale price 20,000 (excl VAT) → loss 10,000.08
    // VAT 7% × 20,000 = 1,400 → totalCash 21,400
    const asset = await ensureTestAsset({
      category: 'EQUIPMENT',
      purchaseCost: 50000,
      accumulatedDepr: 19999.92,
    });

    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    await tmpl.execute({
      assetId: asset.id,
      disposalDate: new Date(),
      disposalProceeds: 20000,
      depositAccountCode: '11-1201',
      issueTaxInvoice: true,
    });

    const je = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['assetId'], equals: asset.id } } as any,
      include: { lines: true },
    });
    const lines = je!.lines;

    const drSum = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const crSum = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));

    // Loss line + VAT line both present
    const lossLine = lines.find((l) => l.accountCode === '53-1605');
    expect(lossLine, '53-1605 loss line missing').toBeDefined();
    expect(new Decimal(lossLine!.debit.toString()).toFixed(2)).toBe('10000.08');

    const vatLine = lines.find((l) => l.accountCode === '21-2101');
    expect(vatLine).toBeDefined();
    expect(new Decimal(vatLine!.credit.toString()).toFixed(2)).toBe('1400.00');

    // Cash = proceeds + VAT
    const cashLine = lines.find((l) => l.accountCode === '11-1201');
    expect(new Decimal(cashLine!.debit.toString()).toFixed(2)).toBe('21400.00');

    // No gain account
    expect(lines.find((l) => l.accountCode === '42-1105')).toBeUndefined();
  });

  it('VAT on disposal: rejected on write-off (proceeds=0)', async () => {
    const asset = await ensureTestAsset({ purchaseCost: 50000, accumulatedDepr: 19999.92 });
    const tmpl = new AssetDisposalTemplate(journal, prisma as any);
    await expect(
      tmpl.execute({
        assetId: asset.id,
        disposalDate: new Date(),
        disposalProceeds: 0,
        issueTaxInvoice: true,
      }),
    ).rejects.toThrow(/ใบกำกับ/);
  });
});
