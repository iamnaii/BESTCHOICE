import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { ExpenseTemplate } from './expense.template';
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

  let branch = await prisma.branch.findFirst({ where: { name: '__expense_test_branch__', deletedAt: null } });
  if (!branch) {
    branch = await prisma.branch.create({ data: { name: '__expense_test_branch__', companyId: company.id } });
  }

  const email = 'expense-test-user@bestchoice-test.internal';
  let user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, password: 'x', name: 'expense test', role: 'ACCOUNTANT', branchId: branch.id },
    });
  }

  return { branchId: branch.id, userId: user.id };
}

async function createTestExpense(
  prisma: PrismaClient,
  branchId: string,
  userId: string,
  opts?: {
    category?: string;
    amount?: number;
    vatAmount?: number;
    taxDisallowed?: boolean;
    disallowedReason?: string;
    withholdingTax?: number;
    vendorTaxId?: string;
    whtFormType?: 'PND3' | 'PND53';
  },
) {
  const category = (opts?.category ?? 'ADMIN_UTILITIES') as 'ADMIN_UTILITIES' | 'ADMIN_SALARY' | 'ADMIN_TELEPHONE';
  const amount = opts?.amount ?? 1000;
  const vatAmount = opts?.vatAmount ?? 70;
  const totalAmount = amount + vatAmount;
  const withholdingTax = opts?.withholdingTax ?? 0;
  const expenseNumber = `EXP-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return prisma.expense.create({
    data: {
      expenseNumber,
      branchId,
      accountType: 'ADMINISTRATIVE_EXPENSE',
      category,
      description: 'ค่าไฟฟ้าทดสอบ',
      amount: new Decimal(amount),
      vatAmount: new Decimal(vatAmount),
      totalAmount: new Decimal(totalAmount),
      withholdingTax: new Decimal(withholdingTax),
      netPayment: new Decimal(totalAmount - withholdingTax),
      vendorTaxId: opts?.vendorTaxId ?? null,
      whtFormType: opts?.whtFormType ?? null,
      expenseDate: new Date(),
      status: 'PAID',
      createdById: userId,
      taxDisallowed: opts?.taxDisallowed ?? false,
      disallowedReason: opts?.disallowedReason ?? null,
    } as any,
  });
}

async function setup() {
  await prisma.journalPostAuditLog.deleteMany({});
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

describe('ExpenseTemplate', () => {
  let journal: JournalAutoService;
  let branchId: string;
  let userId: string;

  beforeAll(async () => {
    journal = await setup();
    const ctx = await ensureBranchAndUser(prisma);
    branchId = ctx.branchId;
    userId = ctx.userId;
  });

  it('posts a balanced expense JE (paid, with VAT)', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_UTILITIES',
      amount: 1000,
      vatAmount: 70,
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      expenseId: expense.id,
      depositAccountCode: '11-1101',
      isPaid: true,
    });

    expect(result).not.toBeNull();
    expect(result!.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(je).toBeDefined();
    expect(je!.status).toBe('POSTED');

    const lines = je!.lines;
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Dr 53-1302 ค่าไฟฟ้า
    const expenseLine = lines.find((l) => l.accountCode === '53-1302');
    expect(expenseLine).toBeDefined();
    expect(new Decimal(expenseLine!.debit.toString()).toFixed(2)).toBe('1000.00');

    // Dr 11-4101 ภาษีซื้อ
    const vatLine = lines.find((l) => l.accountCode === '11-4101');
    expect(vatLine).toBeDefined();
    expect(new Decimal(vatLine!.debit.toString()).toFixed(2)).toBe('70.00');

    // Cr 11-1101 เงินสด
    const cashLine = lines.find((l) => l.accountCode === '11-1101');
    expect(cashLine).toBeDefined();
    expect(new Decimal(cashLine!.credit.toString()).toFixed(2)).toBe('1070.00');
  });

  it('credits AP (21-1104) when isPaid=false', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_SALARY',
      amount: 5000,
      vatAmount: 0,
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      expenseId: expense.id,
      isPaid: false,
    });

    expect(result).not.toBeNull();

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(je).toBeDefined();
    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Cr 21-1104 เจ้าหนี้ค่าใช้จ่ายกิจการ
    const apLine = je!.lines.find((l) => l.accountCode === '21-1104');
    expect(apLine).toBeDefined();
    expect(new Decimal(apLine!.credit.toString()).toFixed(2)).toBe('5000.00');
  });

  it('tax-disallowed: routes to 54-1101 (NO_RECEIPT) and skips VAT input', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_UTILITIES',
      amount: 1000,
      vatAmount: 70,
      taxDisallowed: true,
      disallowedReason: 'NO_RECEIPT',
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      expenseId: expense.id,
      depositAccountCode: '11-1101',
      isPaid: true,
    });

    expect(result).not.toBeNull();

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(je).toBeDefined();
    const lines = je!.lines;

    // Balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Dr 54-1101 (tax-disallowed, full totalAmount including VAT — cannot claim VAT input)
    const disallowedLine = lines.find((l) => l.accountCode === '54-1101');
    expect(disallowedLine).toBeDefined();
    expect(new Decimal(disallowedLine!.debit.toString()).toFixed(2)).toBe('1070.00');

    // No 11-4101 VAT input (disallowed expenses cannot claim VAT)
    const vatLine = lines.find((l) => l.accountCode === '11-4101');
    expect(vatLine).toBeUndefined();

    // Normal expense account (53-1302) should NOT appear
    const normalLine = lines.find((l) => l.accountCode === '53-1302');
    expect(normalLine).toBeUndefined();
  });

  it('tax-disallowed: routes to 54-1103 (PENALTY) and skips VAT input', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_UTILITIES',
      amount: 500,
      vatAmount: 35,
      taxDisallowed: true,
      disallowedReason: 'PENALTY',
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      expenseId: expense.id,
      depositAccountCode: '11-1101',
      isPaid: true,
    });

    expect(result).not.toBeNull();

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });

    const lines = je!.lines;

    // Balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Dr 54-1103 (VAT penalty disallowed — full totalAmount = 500 + 35 = 535)
    const disallowedLine = lines.find((l) => l.accountCode === '54-1103');
    expect(disallowedLine).toBeDefined();
    expect(new Decimal(disallowedLine!.debit.toString()).toFixed(2)).toBe('535.00');

    // No VAT input
    const vatLine = lines.find((l) => l.accountCode === '11-4101');
    expect(vatLine).toBeUndefined();
  });

  it('WHT — corporate vendor (vendorTaxId starts with 0) → 21-3103 (PND53), Cr cash = netPayment', async () => {
    // ค่าเช่า 10,000 + VAT 7% 700 = 10,700; WHT 5% 500; netPayment = 10,200
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_TELEPHONE',
      amount: 10000,
      vatAmount: 700,
      withholdingTax: 500,
      vendorTaxId: '0105561234567', // corporate
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      expenseId: expense.id,
      depositAccountCode: '11-1201',
      isPaid: true,
    });
    expect(result).not.toBeNull();

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });
    expect(je).toBeDefined();
    const lines = je!.lines;

    // Balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    expect(totalDr.toFixed(2)).toBe('10700.00');

    // Cr 21-3103 = 500 (WHT PND53)
    const whtLine = lines.find((l) => l.accountCode === '21-3103');
    expect(whtLine, 'Cr 21-3103 WHT line missing').toBeDefined();
    expect(new Decimal(whtLine!.credit.toString()).toFixed(2)).toBe('500.00');

    // No 21-3102 (PND3 should NOT appear for corporate vendor)
    expect(lines.find((l) => l.accountCode === '21-3102')).toBeUndefined();

    // Cr 11-1201 = netPayment = 10,200 (NOT 10,700)
    const cashLine = lines.find((l) => l.accountCode === '11-1201');
    expect(cashLine, 'Cr 11-1201 cash line missing').toBeDefined();
    expect(new Decimal(cashLine!.credit.toString()).toFixed(2)).toBe('10200.00');
  });

  it('WHT — individual vendor (vendorTaxId does NOT start with 0) → 21-3102 (PND3)', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_MAINTENANCE' as any,
      amount: 5000,
      vatAmount: 350,
      withholdingTax: 150, // 3% on 5000
      vendorTaxId: '1234567890123', // individual (starts with 1)
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    await tmpl.execute({
      expenseId: expense.id,
      depositAccountCode: '11-1101',
      isPaid: true,
    });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });
    const lines = je!.lines;

    // Cr 21-3102 = 150 (WHT PND3 individual)
    const whtLine = lines.find((l) => l.accountCode === '21-3102');
    expect(whtLine, 'Cr 21-3102 WHT (PND3) line missing for individual vendor').toBeDefined();
    expect(new Decimal(whtLine!.credit.toString()).toFixed(2)).toBe('150.00');

    expect(lines.find((l) => l.accountCode === '21-3103')).toBeUndefined();

    // Cr cash = total - WHT = 5350 - 150 = 5200
    const cashLine = lines.find((l) => l.accountCode === '11-1101');
    expect(new Decimal(cashLine!.credit.toString()).toFixed(2)).toBe('5200.00');
  });

  it('WHT — defaults to 21-3103 when vendorTaxId is null', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_TELEPHONE',
      amount: 1000,
      vatAmount: 70,
      withholdingTax: 30,
      vendorTaxId: undefined, // null
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    await tmpl.execute({ expenseId: expense.id, isPaid: true });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });
    expect(je!.lines.find((l) => l.accountCode === '21-3103')).toBeDefined();
  });

  it('WHT skipped on tax-disallowed (penalties cannot claim WHT)', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_UTILITIES',
      amount: 1000,
      vatAmount: 70,
      withholdingTax: 50,
      vendorTaxId: '0105561234567',
      taxDisallowed: true,
      disallowedReason: 'PENALTY',
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    await tmpl.execute({ expenseId: expense.id, isPaid: true });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });
    const lines = je!.lines;

    // No WHT line on disallowed
    expect(lines.find((l) => l.accountCode === '21-3102')).toBeUndefined();
    expect(lines.find((l) => l.accountCode === '21-3103')).toBeUndefined();

    // Full totalAmount to disallowed account
    const disallowed = lines.find((l) => l.accountCode === '54-1103');
    expect(disallowed).toBeDefined();
    expect(new Decimal(disallowed!.debit.toString()).toFixed(2)).toBe('1070.00');
  });

  it('WHT — explicit whtFormType=PND3 overrides vendorTaxId heuristic', async () => {
    // vendorTaxId starts with 0 (would heuristically route to PND53 / 21-3103)
    // but whtFormType=PND3 must take precedence → 21-3102
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_TELEPHONE',
      amount: 1000,
      vatAmount: 70,
      withholdingTax: 30,
      vendorTaxId: '0105561234567', // looks corporate by heuristic
      whtFormType: 'PND3', // explicit individual override
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    await tmpl.execute({ expenseId: expense.id, isPaid: true });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });
    const lines = je!.lines;

    // whtFormType wins → 21-3102, not 21-3103
    expect(lines.find((l) => l.accountCode === '21-3102')).toBeDefined();
    expect(lines.find((l) => l.accountCode === '21-3103')).toBeUndefined();
  });

  it('WHT skipped on accrual (isPaid=false) — settled at clearance', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_TELEPHONE',
      amount: 1000,
      vatAmount: 70,
      withholdingTax: 50,
      vendorTaxId: '0105561234567',
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    await tmpl.execute({ expenseId: expense.id, isPaid: false });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
      },
      include: { lines: true },
    });
    const lines = je!.lines;

    // No WHT line on accrual
    expect(lines.find((l) => l.accountCode === '21-3102')).toBeUndefined();
    expect(lines.find((l) => l.accountCode === '21-3103')).toBeUndefined();

    // Cr 21-1104 = full totalAmount (1070, NOT 1020)
    const apLine = lines.find((l) => l.accountCode === '21-1104');
    expect(apLine).toBeDefined();
    expect(new Decimal(apLine!.credit.toString()).toFixed(2)).toBe('1070.00');
  });

  it('is idempotent — second call returns same entry', async () => {
    const expense = await createTestExpense(prisma, branchId, userId, {
      category: 'ADMIN_TELEPHONE',
      amount: 300,
      vatAmount: 21,
    });

    const tmpl = new ExpenseTemplate(journal, prisma as any);
    const first = await tmpl.execute({ expenseId: expense.id, isPaid: true });
    const second = await tmpl.execute({ expenseId: expense.id, isPaid: true });

    expect(first!.entryNo).toBe(second!.entryNo);

    const count = await prisma.journalEntry.count({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expense.id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(count).toBe(1);
  });
});
