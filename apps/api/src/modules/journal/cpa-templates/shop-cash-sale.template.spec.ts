import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../journal-auto.service';
import { ShopCashSaleTemplate } from './shop-cash-sale.template';

const prisma = new PrismaClient();
let template: ShopCashSaleTemplate;

async function ensureShopCompany() {
  const co = await prisma.companyInfo.findFirst({ where: { companyCode: 'SHOP' } });
  if (!co) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE SHOP',
        taxId: '0000000000001',
        companyCode: 'SHOP',
        address: '1 Shop Rd.',
        directorName: 'Test Director',
        vatRegistered: false,
      },
    });
  }
}

async function ensureFinanceCompany() {
  const fin = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!fin) {
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
}

async function ensureSystemUser() {
  let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }
  return admin.id;
}

async function setup() {
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  await ensureSystemUser();
  await ensureShopCompany();
  await ensureFinanceCompany();

  const journal = new JournalAutoService(prisma as any);
  return new ShopCashSaleTemplate(journal, prisma as any);
}

describe('ShopCashSaleTemplate', () => {
  beforeAll(async () => {
    template = await setup();
  });

  beforeEach(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
  });

  it('posts Dr cash / Cr revenue + Dr COGS / Cr inventory on SHOP company', async () => {
    const result = await template.execute({
      idempotencyKey: `sale-${Date.now()}-1`,
      saleId: 'sale-1',
      saleNumber: 'S-001',
      cashAccountCode: 'S11-1101',
      revenueAccountCode: 'S41-1101',
      revenueAmount: new Decimal(15000),
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
      inventoryCost: new Decimal(12000),
    });
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    const je = await prisma.journalEntry.findUnique({
      where: { id: result.journalEntryId },
      include: { lines: true, company: true },
    });
    expect(je).toBeTruthy();
    expect(je!.status).toBe('POSTED');
    expect(je!.company.companyCode).toBe('SHOP');
    expect(je!.lines).toHaveLength(4);

    const drCash = je!.lines.find((l) => l.accountCode === 'S11-1101')!;
    const crRev = je!.lines.find((l) => l.accountCode === 'S41-1101')!;
    const drCogs = je!.lines.find((l) => l.accountCode === 'S50-1101')!;
    const crInv = je!.lines.find((l) => l.accountCode === 'S11-2001')!;
    expect(new Decimal(drCash.debit.toString()).toFixed(2)).toBe('15000.00');
    expect(new Decimal(crRev.credit.toString()).toFixed(2)).toBe('15000.00');
    expect(new Decimal(drCogs.debit.toString()).toFixed(2)).toBe('12000.00');
    expect(new Decimal(crInv.credit.toString()).toFixed(2)).toBe('12000.00');
  });

  it('skips COGS pair when inventoryCost = 0', async () => {
    const result = await template.execute({
      idempotencyKey: `sale-${Date.now()}-2`,
      saleId: 'sale-2',
      cashAccountCode: 'S11-1101',
      revenueAccountCode: 'S41-1103',
      revenueAmount: new Decimal(100),
      cogsAccountCode: 'S50-1103',
      inventoryAccountCode: 'S11-2003',
      inventoryCost: new Decimal(0),
    });
    const je = await prisma.journalEntry.findUnique({
      where: { id: result.journalEntryId },
      include: { lines: true },
    });
    expect(je!.lines).toHaveLength(2);
  });

  it('is idempotent — second call returns the same entry', async () => {
    const key = `sale-${Date.now()}-3`;
    const first = await template.execute({
      idempotencyKey: key,
      saleId: 'sale-3',
      cashAccountCode: 'S11-1101',
      revenueAccountCode: 'S41-1101',
      revenueAmount: new Decimal(100),
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
      inventoryCost: new Decimal(50),
    });
    const second = await template.execute({
      idempotencyKey: key,
      saleId: 'sale-3',
      cashAccountCode: 'S11-1101',
      revenueAccountCode: 'S41-1101',
      revenueAmount: new Decimal(100),
      cogsAccountCode: 'S50-1101',
      inventoryAccountCode: 'S11-2001',
      inventoryCost: new Decimal(50),
    });
    expect(second.entryNo).toBe(first.entryNo);
    expect(second.journalEntryId).toBe(first.journalEntryId);
  });

  it('rejects FINANCE-prefix accounts', async () => {
    await expect(
      template.execute({
        idempotencyKey: `sale-${Date.now()}-4`,
        saleId: 'sale-4',
        cashAccountCode: '11-1101', // ← FINANCE!
        revenueAccountCode: 'S41-1101',
        revenueAmount: new Decimal(100),
        cogsAccountCode: 'S50-1101',
        inventoryAccountCode: 'S11-2001',
        inventoryCost: new Decimal(50),
      }),
    ).rejects.toThrow(/SHOP-side/);
  });

  it('rejects zero revenue', async () => {
    await expect(
      template.execute({
        idempotencyKey: `sale-${Date.now()}-5`,
        saleId: 'sale-5',
        cashAccountCode: 'S11-1101',
        revenueAccountCode: 'S41-1101',
        revenueAmount: new Decimal(0),
        cogsAccountCode: 'S50-1101',
        inventoryAccountCode: 'S11-2001',
        inventoryCost: new Decimal(0),
      }),
    ).rejects.toThrow(/revenueAmount/);
  });
});
