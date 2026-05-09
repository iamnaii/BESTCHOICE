import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { ExpenseTemplate } from './expense.template';
import { ExpenseReverseTemplate } from './expense-reverse.template';
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
  let branch = await prisma.branch.findFirst({ where: { name: '__expense_reverse_test__', deletedAt: null } });
  if (!branch) {
    branch = await prisma.branch.create({ data: { name: '__expense_reverse_test__', companyId: company.id } });
  }
  const email = 'expense-reverse-test@bestchoice-test.internal';
  let user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, password: 'x', name: 'expense reverse test', role: 'OWNER', branchId: branch.id },
    });
  }
  return { branchId: branch.id, userId: user.id };
}

async function makeExpense(branchId: string, userId: string, overrides: Partial<any> = {}) {
  const expenseNumber = `EXP-REV-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.expense.create({
    data: {
      expenseNumber,
      branchId,
      accountType: 'ADMINISTRATIVE_EXPENSE',
      category: 'ADMIN_TELEPHONE',
      description: 'ค่าทดสอบ reverse',
      amount: new Decimal(1000),
      vatAmount: new Decimal(70),
      totalAmount: new Decimal(1070),
      withholdingTax: new Decimal(0),
      netPayment: new Decimal(1070),
      expenseDate: new Date(),
      status: 'PAID',
      createdById: userId,
      ...overrides,
    } as any,
  });
}

describe('ExpenseReverseTemplate', () => {
  let journal: JournalAutoService;
  let branchId: string;
  let userId: string;
  let template: ExpenseTemplate;
  let reverseTemplate: ExpenseReverseTemplate;

  beforeAll(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await seedFinanceCoa(prisma);

    journal = new JournalAutoService(prisma as any);
    template = new ExpenseTemplate(journal, prisma as any);
    reverseTemplate = new ExpenseReverseTemplate(journal, prisma as any);

    const ctx = await ensureBranchAndUser(prisma);
    branchId = ctx.branchId;
    userId = ctx.userId;
  });

  it('posts a balanced mirror JE with [VOID] descriptions', async () => {
    const expense = await makeExpense(branchId, userId);
    const original = await template.execute({ expenseId: expense.id, isPaid: true });
    expect(original).not.toBeNull();

    const reversed = await reverseTemplate.execute({
      expenseId: expense.id,
      reversedById: userId,
      reason: 'คีย์ผิด',
    });
    expect(reversed.entryNo).toMatch(/^JE-/);

    const reverseJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense-reverse' } as any },
          { metadata: { path: ['expenseId'], equals: expense.id } as any },
        ],
      },
      include: { lines: true },
    });
    expect(reverseJe).toBeDefined();
    const drSum = reverseJe!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const crSum = reverseJe!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
    expect(drSum.toFixed(2)).toBe('1070.00');

    // All lines have [VOID] prefix
    for (const l of reverseJe!.lines) {
      expect(l.description?.startsWith('[VOID]'), `line ${l.accountCode} missing [VOID] prefix`).toBe(true);
    }

    // Mirror: Dr 11-1101 (cash returned), Cr 53-1303 (expense), Cr 11-4101 (VAT)
    const cashLine = reverseJe!.lines.find((l) => l.accountCode === '11-1101');
    expect(new Decimal(cashLine!.debit.toString()).toFixed(2)).toBe('1070.00');
    const expenseLine = reverseJe!.lines.find((l) => l.accountCode === '53-1303');
    expect(new Decimal(expenseLine!.credit.toString()).toFixed(2)).toBe('1000.00');

    // Original JE flagged reversed
    const originalJe = await prisma.journalEntry.findFirst({
      where: { entryNumber: original!.entryNo },
    });
    const meta = originalJe!.metadata as Record<string, unknown>;
    expect(meta.reversed).toBe(true);
    expect(meta.reversedByEntryNumber).toBe(reversed.entryNo);
  });

  it('refuses to reverse an already-reversed JE', async () => {
    const expense = await makeExpense(branchId, userId);
    await template.execute({ expenseId: expense.id, isPaid: true });
    await reverseTemplate.execute({ expenseId: expense.id, reversedById: userId, reason: 'first' });

    await expect(
      reverseTemplate.execute({ expenseId: expense.id, reversedById: userId, reason: 'second' }),
    ).rejects.toThrow(/reverse/);
  });

  it('refuses with empty reason', async () => {
    const expense = await makeExpense(branchId, userId);
    await template.execute({ expenseId: expense.id, isPaid: true });
    await expect(
      reverseTemplate.execute({ expenseId: expense.id, reversedById: userId, reason: '   ' }),
    ).rejects.toThrow(/เหตุผล/);
  });

  it('reverses only the matching expenseId — sibling expenses are not touched', async () => {
    // Two distinct expenses, both PAID, both with flow='expense' JE.
    // Reversing one must NOT mark the other's JE as reversed.
    const e1 = await makeExpense(branchId, userId);
    const e2 = await makeExpense(branchId, userId);
    const r1 = await template.execute({ expenseId: e1.id, isPaid: true });
    const r2 = await template.execute({ expenseId: e2.id, isPaid: true });
    expect(r1!.entryNo).not.toBe(r2!.entryNo);

    await reverseTemplate.execute({
      expenseId: e1.id,
      reversedById: userId,
      reason: 'reverse only e1',
    });

    const e1Original = await prisma.journalEntry.findFirst({ where: { entryNumber: r1!.entryNo } });
    const e2Original = await prisma.journalEntry.findFirst({ where: { entryNumber: r2!.entryNo } });
    expect((e1Original!.metadata as Record<string, unknown>).reversed).toBe(true);
    expect((e2Original!.metadata as Record<string, unknown>).reversed).toBeUndefined();
  });

  it('handles flowOverride to reverse clearance leg of 2-step accrual', async () => {
    const expense = await makeExpense(branchId, userId);
    // accrual leg
    await template.execute({ expenseId: expense.id, isPaid: false });

    // simulate clearance JE manually (testing the override on reverse, not clearance template here)
    const accrual = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } as any },
          { metadata: { path: ['expenseId'], equals: expense.id } as any },
        ],
      },
    });
    expect(accrual).toBeDefined();

    // Posting a fake clearance JE so flowOverride='expense-clearance' has something to reverse
    await journal.createAndPost({
      description: 'fake clearance',
      reference: `${expense.id}:expense-clearance`,
      metadata: {
        tag: 'EXPENSE_CLEARANCE',
        flow: 'expense-clearance',
        expenseId: expense.id,
        expenseNumber: expense.expenseNumber,
      },
      lines: [
        { accountCode: '21-1104', dr: new Decimal(1070), cr: new Decimal(0), description: 'ล้างเจ้าหนี้' },
        { accountCode: '11-1101', dr: new Decimal(0), cr: new Decimal(1070), description: 'จ่าย' },
      ],
    });

    const reversed = await reverseTemplate.execute({
      expenseId: expense.id,
      reversedById: userId,
      reason: 'reverse clearance',
      flowOverride: 'expense-clearance',
    });
    expect(reversed.entryNo).toMatch(/^JE-/);

    const reverseJe = await prisma.journalEntry.findFirst({
      where: { entryNumber: reversed.entryNo },
      include: { lines: true },
    });
    const meta = reverseJe!.metadata as Record<string, unknown>;
    expect(meta.flow).toBe('expense-clearance-reverse');
    expect(meta.originalFlow).toBe('expense-clearance');
  });
});
