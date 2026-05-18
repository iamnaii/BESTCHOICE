import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../journal-auto.service';
import { ShopTradeInTemplate } from './shop-trade-in.template';

const prisma = new PrismaClient();
let template: ShopTradeInTemplate;

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
  return new ShopTradeInTemplate(journal, prisma as any);
}

describe('ShopTradeInTemplate', () => {
  beforeAll(async () => {
    template = await setup();
  });

  beforeEach(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
  });

  it('posts Dr S11-2002 / Cr cash for the tradeInPrice', async () => {
    const r = await template.execute({
      idempotencyKey: `tradein-${Date.now()}-1`,
      tradeInId: 'ti-1',
      tradeInNumber: 'TI-001',
      cashAccountCode: 'S11-1101',
      tradeInPrice: new Decimal(5000),
    });
    const je = await prisma.journalEntry.findUnique({
      where: { id: r.journalEntryId },
      include: { lines: true, company: true },
    });
    expect(je!.company.companyCode).toBe('SHOP');
    expect(je!.lines).toHaveLength(2);
    const dr = je!.lines.find((l) => l.accountCode === 'S11-2002')!;
    const cr = je!.lines.find((l) => l.accountCode === 'S11-1101')!;
    expect(new Decimal(dr.debit.toString()).toFixed(2)).toBe('5000.00');
    expect(new Decimal(cr.credit.toString()).toFixed(2)).toBe('5000.00');
  });

  it('is idempotent', async () => {
    const key = `tradein-${Date.now()}-2`;
    const a = await template.execute({
      idempotencyKey: key,
      tradeInId: 'ti-2',
      cashAccountCode: 'S11-1101',
      tradeInPrice: new Decimal(1000),
    });
    const b = await template.execute({
      idempotencyKey: key,
      tradeInId: 'ti-2',
      cashAccountCode: 'S11-1101',
      tradeInPrice: new Decimal(1000),
    });
    expect(b.journalEntryId).toBe(a.journalEntryId);
  });

  it('rejects zero price', async () => {
    await expect(
      template.execute({
        idempotencyKey: `tradein-${Date.now()}-3`,
        tradeInId: 'ti-3',
        cashAccountCode: 'S11-1101',
        tradeInPrice: new Decimal(0),
      }),
    ).rejects.toThrow(/tradeInPrice/);
  });
});
