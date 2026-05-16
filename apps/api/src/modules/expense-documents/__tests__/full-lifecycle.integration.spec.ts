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

describe('ExpenseDocuments full lifecycle (integration)', () => {
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
        data: { name: '__test_branch_expdoc__', companyId: co.id },
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
    // Clean expense data + their JEs between tests so numbering & filtering tests
    // don't pollute each other.
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
      new LineAggregatorService(),
      new JePreviewService(new LineAggregatorService()),
      new SsoConfigService(prisma as never),
      new PettyCashTemplate(journal, prisma as never),
      new PettyCashService(prisma as never),
      new PayrollCustomService(prisma as never),
      { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
    );
  }

  it('Same-day flow: create DRAFT → post → POSTED + balanced JE in DB', async () => {
    const service = buildService();
    const created = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        lines: [
          { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
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
    const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(drSum).toBeCloseTo(crSum, 2);
    expect(drSum).toBeCloseTo(1070, 2);
  });

  it('Accrual flow: create DRAFT (no payment) → post → ACCRUAL + JE without cash leg', async () => {
    const service = buildService();
    const created = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        // No paymentMethod
        lines: [
          { category: '53-1404', quantity: 1, unitPrice: 5000, vatPercent: 7, whtPercent: 0 },
        ],
      } as never,
      userId,
    );

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
    expect(codes).not.toContain('11-1101'); // No cash leg
  });

  it('Tab=draft returns only DRAFT documents', async () => {
    const service = buildService();
    await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [{ category: '53-1302', quantity: 1, unitPrice: 100, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    const accruedDoc = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [{ category: '53-1302', quantity: 1, unitPrice: 200, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    await service.post(accruedDoc.id, userId);

    const draftList = await service.list(
      { tab: 'draft' } as never,
      { branchId, role: 'OWNER' },
    );
    expect(draftList.data.length).toBe(1);
    expect(draftList.data[0].status).toBe('DRAFT');

    const unpaidList = await service.list(
      { tab: 'unpaid' } as never,
      { branchId, role: 'OWNER' },
    );
    expect(unpaidList.data.length).toBe(1);
    expect(unpaidList.data[0].status).toBe('ACCRUAL');
  });

  it('Soft-delete blocks non-DRAFT', async () => {
    const service = buildService();
    const doc = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        lines: [{ category: '53-1302', quantity: 1, unitPrice: 100, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    await service.post(doc.id, userId); // → POSTED
    await expect(service.softDelete(doc.id, userId)).rejects.toThrow();
  });

  it('Numbering increments per-day per-type', async () => {
    const service = buildService();
    const a = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [{ category: '53-1302', quantity: 1, unitPrice: 100, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    const b = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [{ category: '53-1302', quantity: 1, unitPrice: 100, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    expect(a.number).toMatch(/^EX-\d{8}-0001$/);
    expect(b.number).toMatch(/^EX-\d{8}-0002$/);
  });
});
