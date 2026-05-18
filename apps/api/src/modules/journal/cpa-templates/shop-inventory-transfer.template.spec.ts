import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../journal-auto.service';
import { ShopInventoryTransferTemplate } from './shop-inventory-transfer.template';

const prisma = new PrismaClient();
let template: ShopInventoryTransferTemplate;

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
  return new ShopInventoryTransferTemplate(journal, prisma as any);
}

describe('ShopInventoryTransferTemplate', () => {
  beforeAll(async () => {
    template = await setup();
  });

  beforeEach(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
  });

  it('posts Dr S11-3001 / Cr inventory for the transferPrice on SHOP side', async () => {
    const r = await template.execute({
      idempotencyKey: `inv-${Date.now()}-1`,
      contractId: 'c1',
      contractNumber: 'C-001',
      productId: 'p1',
      productName: 'iPhone',
      inventoryAccountCode: 'S11-2001',
      transferPrice: new Decimal(11000),
    });
    const je = await prisma.journalEntry.findUnique({
      where: { id: r.journalEntryId },
      include: { lines: true, company: true },
    });
    expect(je!.company.companyCode).toBe('SHOP');
    expect(je!.lines).toHaveLength(2);
    const dr = je!.lines.find((l) => l.accountCode === 'S11-3001')!;
    const cr = je!.lines.find((l) => l.accountCode === 'S11-2001')!;
    expect(new Decimal(dr.debit.toString()).toFixed(2)).toBe('11000.00');
    expect(new Decimal(cr.credit.toString()).toFixed(2)).toBe('11000.00');
  });

  it('is idempotent', async () => {
    const key = `inv-${Date.now()}-2`;
    const a = await template.execute({
      idempotencyKey: key,
      contractId: 'c2',
      productId: 'p2',
      inventoryAccountCode: 'S11-2002',
      transferPrice: new Decimal(5000),
    });
    const b = await template.execute({
      idempotencyKey: key,
      contractId: 'c2',
      productId: 'p2',
      inventoryAccountCode: 'S11-2002',
      transferPrice: new Decimal(5000),
    });
    expect(b.journalEntryId).toBe(a.journalEntryId);
  });

  it('rejects non-SHOP inventory account', async () => {
    await expect(
      template.execute({
        idempotencyKey: `inv-${Date.now()}-3`,
        contractId: 'c3',
        productId: 'p3',
        inventoryAccountCode: '11-3101',
        transferPrice: new Decimal(1000),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });
});
