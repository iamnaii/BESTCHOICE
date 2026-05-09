import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { ExpenseTemplate } from './expense.template';
import { ExpenseClearanceTemplate } from './expense-clearance.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function ensureBranchAndUser(prisma: PrismaClient) {
  let company = await prisma.companyInfo.findFirst({ where: { companyCode: 'TEST_FINANCE' } });
  if (!company) {
    company = await prisma.companyInfo.create({
      data: {
        nameTh: 'Test Finance Co.',
        taxId: '0000000000001',
        companyCode: 'TEST_FINANCE',
        address: '1 Test Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: new Decimal('0.0700'),
      },
    });
  }
  let branch = await prisma.branch.findFirst({ where: { name: '__expense_clearance_test__', deletedAt: null } });
  if (!branch) {
    branch = await prisma.branch.create({ data: { name: '__expense_clearance_test__', companyId: company.id } });
  }
  const email = 'expense-clearance-test@bestchoice-test.internal';
  let user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, password: 'x', name: 'expense clearance test', role: 'ACCOUNTANT', branchId: branch.id },
    });
  }
  return { branchId: branch.id, userId: user.id };
}

async function makeExpense(branchId: string, userId: string, overrides: Partial<any> = {}) {
  const expenseNumber = `EXP-CLR-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const amount = overrides.amount ?? 1000;
  const vatAmount = overrides.vatAmount ?? 70;
  const totalAmount = (amount as number) + (vatAmount as number);
  const withholdingTax = overrides.withholdingTax ?? 0;
  return prisma.expense.create({
    data: {
      expenseNumber,
      branchId,
      accountType: 'ADMINISTRATIVE_EXPENSE',
      category: 'ADMIN_TELEPHONE',
      description: 'ค่าทดสอบ clearance',
      amount: new Decimal(amount as number),
      vatAmount: new Decimal(vatAmount as number),
      totalAmount: new Decimal(totalAmount),
      withholdingTax: new Decimal(withholdingTax as number),
      netPayment: new Decimal(totalAmount - (withholdingTax as number)),
      vendorTaxId: overrides.vendorTaxId ?? null,
      expenseDate: new Date(),
      status: 'PAID',
      createdById: userId,
      ...overrides,
    } as any,
  });
}

describe('ExpenseClearanceTemplate', () => {
  let journal: JournalAutoService;
  let branchId: string;
  let userId: string;
  let expenseTemplate: ExpenseTemplate;
  let clearanceTemplate: ExpenseClearanceTemplate;

  beforeAll(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await seedFinanceCoa(prisma);

    journal = new JournalAutoService(prisma as any);
    expenseTemplate = new ExpenseTemplate(journal, prisma as any);
    clearanceTemplate = new ExpenseClearanceTemplate(journal, prisma as any);

    const ctx = await ensureBranchAndUser(prisma);
    branchId = ctx.branchId;
    userId = ctx.userId;
  });

  it('clears AP without WHT — Dr 21-1104 / Cr cash totalAmount', async () => {
    const expense = await makeExpense(branchId, userId);
    await expenseTemplate.execute({ expenseId: expense.id, isPaid: false });

    const result = await clearanceTemplate.execute({
      expenseId: expense.id,
      depositAccountCode: '11-1201',
    });
    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense-clearance' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });
    expect(je).toBeDefined();
    const lines = je!.lines;

    const drSum = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const crSum = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
    expect(drSum.toFixed(2)).toBe('1070.00');

    expect(new Decimal(lines.find((l) => l.accountCode === '21-1104')!.debit.toString()).toFixed(2)).toBe('1070.00');
    expect(new Decimal(lines.find((l) => l.accountCode === '11-1201')!.credit.toString()).toFixed(2)).toBe('1070.00');
  });

  it('clears AP with WHT (corporate vendor) — splits WHT 21-3103 + net cash', async () => {
    const expense = await makeExpense(branchId, userId, {
      amount: 10000,
      vatAmount: 700,
      withholdingTax: 500,
      vendorTaxId: '0105561234567',
    });
    await expenseTemplate.execute({ expenseId: expense.id, isPaid: false });

    await clearanceTemplate.execute({
      expenseId: expense.id,
      depositAccountCode: '11-1201',
    });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense-clearance' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });
    const lines = je!.lines;

    // Dr 21-1104 = totalAmount = 10,700
    expect(new Decimal(lines.find((l) => l.accountCode === '21-1104')!.debit.toString()).toFixed(2)).toBe('10700.00');
    // Cr 21-3103 = WHT 500
    expect(new Decimal(lines.find((l) => l.accountCode === '21-3103')!.credit.toString()).toFixed(2)).toBe('500.00');
    // Cr cash = net 10,200
    expect(new Decimal(lines.find((l) => l.accountCode === '11-1201')!.credit.toString()).toFixed(2)).toBe('10200.00');
  });

  it('refuses if no accrual JE exists', async () => {
    const expense = await makeExpense(branchId, userId);
    await expect(clearanceTemplate.execute({ expenseId: expense.id })).rejects.toThrow(/accrual/);
  });

  it('idempotent — second call returns same JE', async () => {
    const expense = await makeExpense(branchId, userId);
    await expenseTemplate.execute({ expenseId: expense.id, isPaid: false });

    const first = await clearanceTemplate.execute({ expenseId: expense.id });
    const second = await clearanceTemplate.execute({ expenseId: expense.id });
    expect(first.entryNo).toBe(second.entryNo);

    const count = await prisma.journalEntry.count({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense-clearance' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(count).toBe(1);
  });
});
