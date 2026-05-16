import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient, DocumentStatus } from '@prisma/client';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { DocNumberService } from '../services/doc-number.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { LineAggregatorService } from '../services/line-aggregator.service';
import { JePreviewService } from '../services/je-preview.service';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../../journal/cpa-templates/expense-accrual.template';
import { CreditNoteTemplate } from '../../journal/cpa-templates/credit-note.template';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';
import { VendorSettlementTemplate } from '../../journal/cpa-templates/vendor-settlement.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { SsoConfigService } from '../../sso-config/sso-config.service';
import { PettyCashTemplate } from '../../journal/cpa-templates/petty-cash.template';
import { PettyCashService } from '../services/petty-cash.service';
import { PayrollCustomService } from '../services/payroll-custom.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let userId: string;
let branchId: string;

describe('ExpenseDocuments multi-line lifecycle (integration)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);

    // Ensure branch exists
    const branch = await prisma.branch.findFirst({ where: { deletedAt: null } });
    if (branch) {
      branchId = branch.id;
    } else {
      let co = await prisma.companyInfo.findFirst({ where: { deletedAt: null } });
      if (!co) {
        co = await prisma.companyInfo.create({
          data: {
            nameTh: 'System Co',
            taxId: '9999999999999',
            companyCode: 'SYSTEM',
            address: '1 System Rd',
            directorName: 'System',
            vatRegistered: false,
          },
        });
      }
      const b = await prisma.branch.create({
        data: { name: '__test_branch_multiline__', companyId: co.id },
      });
      branchId = b.id;
    }

    // Ensure system user exists
    const user = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!user) {
      const created = await prisma.user.create({
        data: {
          email: 'admin@bestchoice.com',
          password: 'placeholder',
          name: 'Admin',
          role: 'OWNER',
          branchId,
        },
      });
      userId = created.id;
    } else {
      userId = user.id;
    }
  });

  beforeEach(async () => {
    // Clean expense data + their JEs between tests
    await prisma.$executeRawUnsafe(`
      DELETE FROM journal_lines
      WHERE journal_entry_id IN (
        SELECT id FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%'
      )
    `);
    await prisma.$executeRawUnsafe(
      `DELETE FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%'`,
    );
    await prisma.expenseDocument.deleteMany({});
  });

  function buildService() {
    const journal = new JournalAutoService(prisma as never);
    const sameDay = new ExpenseSameDayTemplate(journal, prisma as never);
    const accrual = new ExpenseAccrualTemplate(journal, prisma as never);
    const cn = new CreditNoteTemplate(journal, prisma as never);
    const payroll = new PayrollTemplate(journal, prisma as never, { code: (r: string) => ({
        payroll_expense: '53-1101',
        payroll_sso_expense: '53-1102',
        wht_payroll: '21-3101',
        sso_employee: '21-3105',
        sso_employer: '21-3106',
      } as Record<string, string>)[r] ?? `__${r}__` } as never);
    const settlement = new VendorSettlementTemplate(journal, prisma as never);
    const aggregator = new LineAggregatorService();
    return new ExpenseDocumentsService(
      prisma as never,
      new DocNumberService(),
      new StatusTransitionService(),
      sameDay,
      accrual,
      cn,
      payroll,
      settlement,
      journal,
      aggregator,
      new JePreviewService(aggregator),
      new SsoConfigService(prisma as never),
      new PettyCashTemplate(journal, prisma as never),
      new PettyCashService(prisma as never),
      new PayrollCustomService(prisma as never),
      { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
    );
  }

  it('3-line invoice with mixed VAT/WHT: post → JE balanced, Dr expenses by category, Cr cash + Cr WHT', async () => {
    const service = buildService();
    const created = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        paymentMethod: 'BANK_TRANSFER',
        depositAccountCode: '11-1201',
        vendorName: 'Test Multi-line Vendor',
        lines: [
          { category: '53-1302', quantity: 1, unitPrice: 5000, vatPercent: 7, whtPercent: 0 },
          { category: '53-1404', quantity: 1, unitPrice: 1500, vatPercent: 7, whtPercent: 3 },
          { category: '53-1302', quantity: 1, unitPrice: 500, vatPercent: 0, whtPercent: 0 },
        ],
      } as never,
      userId,
    );

    expect(created.status).toBe(DocumentStatus.DRAFT);

    await service.post(created.id, userId);

    const after = await prisma.expenseDocument.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(after.status).toBe(DocumentStatus.POSTED);
    expect(after.paidAt).not.toBeNull();
    expect(after.journalEntryId).not.toBeNull();

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! },
      include: { lines: true },
    });

    // Verify balancing
    const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(drSum).toBeCloseTo(crSum, 2);

    // Verify account mix
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('53-1302'); // Expense category
    expect(codes).toContain('53-1404'); // Expense category
    expect(codes).toContain('11-4101'); // VAT Input (Input Tax Credit) — Fix Report P0-1
    expect(codes).toContain('11-1201'); // Bank
    expect(codes).toContain('21-3103'); // WHT Payable

    // Line 1: 5000 (exp) + 350 (vat) = 5350
    // Line 2: 1500 (exp) + 105 (vat) - 45 (wht from exp) = 1560
    // Line 3: 500 (exp) = 500
    // Total paid: 5350 + 1560 + 500 = 7410
    // Total VAT: 350 + 105 = 455
    // Total WHT: 45
    // Expenses Dr: 5000 + 1500 + 500 = 7000
    // VAT Input Dr: 455
    // WHT Payable Cr: 45
    // Bank Cr: 7410
    const expenseLines = je.lines.filter((l) => l.accountCode.startsWith('53-'));
    const expenseSum = expenseLines.reduce((s, l) => s + Number(l.debit), 0);
    expect(expenseSum).toBeCloseTo(7000, 2);

    const vatInputLine = je.lines.find((l) => l.accountCode === '11-4101');
    expect(vatInputLine?.debit).toBeDefined();
    expect(Number(vatInputLine!.debit)).toBeCloseTo(455, 2);

    const whtLine = je.lines.find((l) => l.accountCode === '21-3103');
    expect(whtLine?.credit).toBeDefined();
    expect(Number(whtLine!.credit)).toBeCloseTo(45, 2);
  });

  it('Preview round-trip: preview before save matches JE after post', async () => {
    const service = buildService();
    const dto = {
      documentType: 'EXPENSE' as const,
      branchId,
      documentDate: new Date().toISOString(),
      priceType: 'EXCLUSIVE' as const,
      paymentMethod: 'CASH' as const,
      depositAccountCode: '11-1101',
      vendorName: 'Preview Test Vendor',
      lines: [
        { category: '53-1302', quantity: 2, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
        { category: '53-1404', quantity: 1, unitPrice: 1500, vatPercent: 7, whtPercent: 3 },
      ],
    };

    const preview = await service.previewJe(dto as never);
    expect(preview.totals.balanced).toBe(true);
    const previewDrSum = parseFloat(preview.totals.drSum);

    const created = await service.create(dto as never, userId);
    await service.post(created.id, userId);

    const after = await prisma.expenseDocument.findUniqueOrThrow({
      where: { id: created.id },
    });
    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! },
      include: { lines: true },
    });

    const actualDrSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    expect(actualDrSum).toBeCloseTo(previewDrSum, 2);

    const actualCrSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(actualDrSum).toBeCloseTo(actualCrSum, 2);
  });

  it('Multi-line accrual (no payment method) creates balanced JE with AP instead of cash', async () => {
    const service = buildService();
    const created = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        // No paymentMethod → accrual
        vendorName: 'Accrual Multi-line Vendor',
        lines: [
          { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
          { category: '53-1404', quantity: 1, unitPrice: 2000, vatPercent: 7, whtPercent: 0 },
        ],
      } as never,
      userId,
    );

    expect(created.status).toBe(DocumentStatus.DRAFT);

    await service.post(created.id, userId);
    const after = await prisma.expenseDocument.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(after.status).toBe(DocumentStatus.ACCRUAL);
    expect(after.paidAt).toBeNull();

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! },
      include: { lines: true },
    });

    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('21-1104'); // AP
    expect(codes).not.toContain('11-1101'); // No cash legs
    expect(codes).not.toContain('11-1201');

    // Balancing still holds
    const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(drSum).toBeCloseTo(crSum, 2);
  });

  it('Same expense category across multiple lines aggregates correctly', async () => {
    const service = buildService();
    const created = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        vendorName: 'Same Category Vendor',
        lines: [
          { category: '53-1302', quantity: 2, unitPrice: 500, vatPercent: 7, whtPercent: 0 },
          { category: '53-1302', quantity: 3, unitPrice: 300, vatPercent: 7, whtPercent: 0 },
          { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 },
        ],
      } as never,
      userId,
    );

    await service.post(created.id, userId);

    const after = await prisma.expenseDocument.findUniqueOrThrow({
      where: { id: created.id },
    });
    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! },
      include: { lines: true },
    });

    // Should have consolidated into single 53-1302 Dr line
    const expenseLines = je.lines.filter((l) => l.accountCode === '53-1302');
    expect(expenseLines.length).toBe(1);
    const expenseTotal = Number(expenseLines[0].debit);
    // 2*500 + 3*300 + 1*1000 = 1000 + 900 + 1000 = 2900
    expect(expenseTotal).toBeCloseTo(2900, 2);

    // Verify balancing
    const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(drSum).toBeCloseTo(crSum, 2);
  });
});
