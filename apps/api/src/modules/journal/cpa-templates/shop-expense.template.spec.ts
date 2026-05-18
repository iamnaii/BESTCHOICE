import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../journal-auto.service';
import { ShopExpenseTemplate } from './shop-expense.template';

const prisma = new PrismaClient();
let template: ShopExpenseTemplate;

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
  return new ShopExpenseTemplate(journal, prisma as any);
}

describe('ShopExpenseTemplate', () => {
  beforeAll(async () => {
    template = await setup();
  });

  beforeEach(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
  });

  it('CASH mode — Dr expense / Cr bank', async () => {
    const r = await template.execute({
      idempotencyKey: `exp-${Date.now()}-1`,
      expenseId: 'exp-1',
      expenseAccountCode: 'S52-1101', // rent
      amount: new Decimal(20000),
      mode: 'CASH',
      cashAccountCode: 'S11-1202',
      branchName: 'ลาดพร้าว',
    });
    const je = await prisma.journalEntry.findUnique({
      where: { id: r.journalEntryId },
      include: { lines: true, company: true },
    });
    expect(je!.company.companyCode).toBe('SHOP');
    const dr = je!.lines.find((l) => l.accountCode === 'S52-1101')!;
    const cr = je!.lines.find((l) => l.accountCode === 'S11-1202')!;
    expect(new Decimal(dr.debit.toString()).toFixed(2)).toBe('20000.00');
    expect(new Decimal(cr.credit.toString()).toFixed(2)).toBe('20000.00');
  });

  it('ACCRUAL mode — Dr expense / Cr S21-1103 payable', async () => {
    const r = await template.execute({
      idempotencyKey: `exp-${Date.now()}-2`,
      expenseId: 'exp-2',
      expenseAccountCode: 'S52-1103',
      amount: new Decimal(5000),
      mode: 'ACCRUAL',
    });
    const je = await prisma.journalEntry.findUnique({
      where: { id: r.journalEntryId },
      include: { lines: true },
    });
    const cr = je!.lines.find((l) => l.accountCode === 'S21-1103')!;
    expect(new Decimal(cr.credit.toString()).toFixed(2)).toBe('5000.00');
  });

  it('CASH mode without cashAccountCode is rejected', async () => {
    await expect(
      template.execute({
        idempotencyKey: `exp-${Date.now()}-3`,
        expenseId: 'exp-3',
        expenseAccountCode: 'S52-1101',
        amount: new Decimal(100),
        mode: 'CASH',
        // missing cashAccountCode
      }),
    ).rejects.toThrow(/cashAccountCode required/);
  });

  it('is idempotent', async () => {
    const key = `exp-${Date.now()}-4`;
    const a = await template.execute({
      idempotencyKey: key,
      expenseId: 'exp-4',
      expenseAccountCode: 'S52-1102',
      amount: new Decimal(300),
      mode: 'CASH',
      cashAccountCode: 'S11-1202',
    });
    const b = await template.execute({
      idempotencyKey: key,
      expenseId: 'exp-4',
      expenseAccountCode: 'S52-1102',
      amount: new Decimal(300),
      mode: 'CASH',
      cashAccountCode: 'S11-1202',
    });
    expect(b.journalEntryId).toBe(a.journalEntryId);
  });
});
