import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../journal-auto.service';
import { ShopFinanceReceiptTemplate } from './shop-finance-receipt.template';

const prisma = new PrismaClient();
let template: ShopFinanceReceiptTemplate;

async function setup() {
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!admin) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }
  for (const code of ['SHOP', 'FINANCE'] as const) {
    const co = await prisma.companyInfo.findFirst({ where: { companyCode: code } });
    if (!co) {
      await prisma.companyInfo.create({
        data: {
          nameTh: `BESTCHOICE ${code}`,
          taxId: code === 'SHOP' ? '0000000000001' : '0000000000002',
          companyCode: code,
          address: '1 Rd.',
          directorName: 'Test',
          vatRegistered: code === 'FINANCE',
          vatRate: code === 'FINANCE' ? new Decimal('0.07') : null,
        },
      });
    }
  }
  const journal = new JournalAutoService(prisma as any);
  return new ShopFinanceReceiptTemplate(journal, prisma as any);
}

describe('ShopFinanceReceiptTemplate', () => {
  beforeAll(async () => {
    template = await setup();
  });

  beforeEach(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
  });

  it('books bank receipt + clears down + recognises revenue + commission + COGS — balanced', async () => {
    const r = await template.execute({
      idempotencyKey: `fr-${Date.now()}-1`,
      contractId: 'c1',
      contractNumber: 'C-001',
      bankAccountCode: 'S11-1201',
      salePrice: new Decimal(15000),
      downAmount: new Decimal(3000),
      financedAmount: new Decimal(12000),
      commission: new Decimal(1500),
      revenueAccountCode: 'S41-1101',
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
      inventoryCost: new Decimal(11000),
    });
    const je = await prisma.journalEntry.findUnique({
      where: { id: r.journalEntryId },
      include: { lines: true, company: true },
    });
    expect(je!.company.companyCode).toBe('SHOP');

    const sumDr = je!.lines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())),
      new Decimal(0),
    );
    const sumCr = je!.lines.reduce(
      (s, l) => s.plus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(sumDr.toFixed(2)).toBe(sumCr.toFixed(2));

    // Bank receipt = financed + commission = 13500
    const bank = je!.lines.find((l) => l.accountCode === 'S11-1201')!;
    expect(new Decimal(bank.debit.toString()).toFixed(2)).toBe('13500.00');

    // Clear down = 3000
    const downClear = je!.lines.find((l) => l.accountCode === 'S21-2001')!;
    expect(new Decimal(downClear.debit.toString()).toFixed(2)).toBe('3000.00');

    // Revenue (Cr salePrice)
    const rev = je!.lines.find((l) => l.accountCode === 'S41-1101')!;
    expect(new Decimal(rev.credit.toString()).toFixed(2)).toBe('15000.00');

    // Commission income (Cr commission)
    const commission = je!.lines.find((l) => l.accountCode === 'S41-1201')!;
    expect(new Decimal(commission.credit.toString()).toFixed(2)).toBe('1500.00');

    // FINANCE-receivable principal cleared (Cr 12000)
    const receivable = je!.lines.find((l) => l.accountCode === 'S11-3001')!;
    expect(new Decimal(receivable.credit.toString()).toFixed(2)).toBe('12000.00');

    // FINANCE-receivable commission cleared (Cr 1500)
    const receivableComm = je!.lines.find((l) => l.accountCode === 'S11-3002')!;
    expect(new Decimal(receivableComm.credit.toString()).toFixed(2)).toBe('1500.00');

    // COGS pair (11000)
    const cogs = je!.lines.find((l) => l.accountCode === 'S50-1101')!;
    const inv = je!.lines.find((l) => l.accountCode === 'S11-2001')!;
    expect(new Decimal(cogs.debit.toString()).toFixed(2)).toBe('11000.00');
    expect(new Decimal(inv.credit.toString()).toFixed(2)).toBe('11000.00');
  });

  it('rejects when down + financed ≠ salePrice', async () => {
    await expect(
      template.execute({
        idempotencyKey: `fr-${Date.now()}-2`,
        contractId: 'c2',
        bankAccountCode: 'S11-1201',
        salePrice: new Decimal(15000),
        downAmount: new Decimal(3000),
        financedAmount: new Decimal(10000), // wrong
        commission: new Decimal(1500),
        revenueAccountCode: 'S41-1101',
        cogsAccountCode: 'S50-1101',
        inventoryAccountCode: 'S11-2001',
        inventoryCost: new Decimal(11000),
      }),
    ).rejects.toThrow(/must equal salePrice/);
  });

  it('is idempotent', async () => {
    const key = `fr-${Date.now()}-3`;
    const a = await template.execute({
      idempotencyKey: key,
      contractId: 'c3',
      bankAccountCode: 'S11-1201',
      salePrice: new Decimal(10000),
      downAmount: new Decimal(2000),
      financedAmount: new Decimal(8000),
      commission: new Decimal(800),
      revenueAccountCode: 'S41-1101',
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
      inventoryCost: new Decimal(7000),
    });
    const b = await template.execute({
      idempotencyKey: key,
      contractId: 'c3',
      bankAccountCode: 'S11-1201',
      salePrice: new Decimal(10000),
      downAmount: new Decimal(2000),
      financedAmount: new Decimal(8000),
      commission: new Decimal(800),
      revenueAccountCode: 'S41-1101',
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
      inventoryCost: new Decimal(7000),
    });
    expect(b.journalEntryId).toBe(a.journalEntryId);
  });
});
