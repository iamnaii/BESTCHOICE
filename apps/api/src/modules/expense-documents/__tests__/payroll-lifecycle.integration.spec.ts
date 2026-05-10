import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient, DocumentStatus } from '@prisma/client';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { DocNumberService } from '../services/doc-number.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../../journal/cpa-templates/expense-accrual.template';
import { CreditNoteTemplate } from '../../journal/cpa-templates/credit-note.template';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';
import { VendorSettlementTemplate } from '../../journal/cpa-templates/vendor-settlement.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let userId: string;
let branchId: string;

describe('Payroll lifecycle (integration)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    const branch = await prisma.branch.findFirst({ where: { deletedAt: null } });
    branchId = branch!.id;
    const user = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    userId = user!.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      DELETE FROM journal_lines
      WHERE journal_entry_id IN (
        SELECT id FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%'
      )
    `);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%'`);
    await prisma.expenseDocument.deleteMany();
  });

  function buildService() {
    const journal = new JournalAutoService(prisma as never);
    const sameDay = new ExpenseSameDayTemplate(journal, prisma as never);
    const accrual = new ExpenseAccrualTemplate(journal, prisma as never);
    const cn = new CreditNoteTemplate(journal, prisma as never);
    const payroll = new PayrollTemplate(journal, prisma as never);
    const settlement = new VendorSettlementTemplate(journal, prisma as never);
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
    );
  }

  it('Multi-line payroll: create with 3 employees → post → balanced JE with sums', async () => {
    const service = buildService();
    const pr = await service.createPayroll(
      {
        branchId,
        documentDate: new Date().toISOString(),
        payrollPeriod: '2026-05',
        depositAccountCode: '11-1101',
        lines: [
          { employeeName: 'A', baseSalary: 10000, ssoEmployee: 750, whtAmount: 0 },
          { employeeName: 'B', baseSalary: 15000, ssoEmployee: 750, whtAmount: 300 },
          { employeeName: 'C', baseSalary: 20000, ssoEmployee: 750, whtAmount: 800 },
        ],
      } as never,
      { id: userId, branchId, role: 'OWNER' },
    );
    expect(pr.documentType).toBe('PAYROLL');
    expect(pr.subtotal.toString()).toBe('45000');
    expect(pr.netPayment?.toString()).toBe('41650'); // 45000 - 2250 (sso) - 1100 (wht)

    await service.post(pr.id, userId);
    const after = await prisma.expenseDocument.findUniqueOrThrow({
      where: { id: pr.id },
      include: { payroll: { include: { lines: true } } },
    });
    expect(after.status).toBe(DocumentStatus.POSTED);
    expect(after.payroll!.lines.length).toBe(3);

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! },
      include: { lines: true },
    });
    const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(drSum).toBeCloseTo(crSum, 2);
    expect(drSum).toBeCloseTo(45000, 2); // Σ baseSalary

    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('53-1101'); // salary expense
    expect(codes).toContain('21-3101'); // WHT (ภ.ง.ด. 1 ค้างจ่าย)
    expect(codes).toContain('21-1104'); // SSO placeholder (CPA review)
    expect(codes).toContain('11-1101'); // cash
  });

  it('Rejects payroll with negative netPaid line', async () => {
    const service = buildService();
    await expect(service.createPayroll(
      {
        branchId,
        documentDate: new Date().toISOString(),
        payrollPeriod: '2026-05',
        depositAccountCode: '11-1101',
        lines: [{ employeeName: 'X', baseSalary: 1000, ssoEmployee: 700, whtAmount: 500 }],
      } as never,
      { id: userId, branchId, role: 'OWNER' },
    )).rejects.toThrow(/เงินสุทธิติดลบ/);
  });

  it('Numbering: PR-YYYYMMDD-0001 for first payroll', async () => {
    const service = buildService();
    const pr = await service.createPayroll(
      {
        branchId,
        documentDate: new Date().toISOString(),
        payrollPeriod: '2026-05',
        depositAccountCode: '11-1101',
        lines: [{ employeeName: 'A', baseSalary: 5000 }],
      } as never,
      { id: userId, branchId, role: 'OWNER' },
    );
    expect(pr.number).toMatch(/^PR-\d{8}-0001$/);
  });
});
