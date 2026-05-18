import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../journal-auto.service';
import { ShopDownPaymentTemplate } from './shop-down-payment.template';

const prisma = new PrismaClient();
let template: ShopDownPaymentTemplate;

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
  const shop = await prisma.companyInfo.findFirst({ where: { companyCode: 'SHOP' } });
  if (!shop) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE SHOP',
        taxId: '0000000000001',
        companyCode: 'SHOP',
        address: '1 Shop Rd.',
        directorName: 'Test',
      },
    });
  }
  const fin = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!fin) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000002',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test',
        vatRegistered: true,
        vatRate: new Decimal('0.07'),
      },
    });
  }
  const journal = new JournalAutoService(prisma as any);
  return new ShopDownPaymentTemplate(journal, prisma as any);
}

describe('ShopDownPaymentTemplate', () => {
  beforeAll(async () => {
    template = await setup();
  });

  beforeEach(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
  });

  it('posts Dr cash / Cr S21-2001 for the down amount', async () => {
    const r = await template.execute({
      idempotencyKey: `down-${Date.now()}-1`,
      contractId: 'c1',
      contractNumber: 'C-001',
      cashAccountCode: 'S11-1101',
      downAmount: new Decimal(3000),
    });
    const je = await prisma.journalEntry.findUnique({
      where: { id: r.journalEntryId },
      include: { lines: true, company: true },
    });
    expect(je!.company.companyCode).toBe('SHOP');
    expect(je!.lines).toHaveLength(2);
    const dr = je!.lines.find((l) => l.accountCode === 'S11-1101')!;
    const cr = je!.lines.find((l) => l.accountCode === 'S21-2001')!;
    expect(new Decimal(dr.debit.toString()).toFixed(2)).toBe('3000.00');
    expect(new Decimal(cr.credit.toString()).toFixed(2)).toBe('3000.00');
  });

  it('is idempotent', async () => {
    const key = `down-${Date.now()}-2`;
    const a = await template.execute({
      idempotencyKey: key,
      contractId: 'c2',
      cashAccountCode: 'S11-1201',
      downAmount: new Decimal(500),
    });
    const b = await template.execute({
      idempotencyKey: key,
      contractId: 'c2',
      cashAccountCode: 'S11-1201',
      downAmount: new Decimal(500),
    });
    expect(b.journalEntryId).toBe(a.journalEntryId);
  });

  it('rejects non-SHOP cash account', async () => {
    await expect(
      template.execute({
        idempotencyKey: `down-${Date.now()}-3`,
        contractId: 'c3',
        cashAccountCode: '11-1101',
        downAmount: new Decimal(100),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });
});
