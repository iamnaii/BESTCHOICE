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

describe('Credit Note lifecycle (integration)', () => {
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
      // D1.1.2.3 — DocNumberService now takes SettingsService; integration
      // tests pass a stub that returns null (→ default daily cycle).
      new DocNumberService({ getKey: async () => null } as never),
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
    );
  }

  it('CN against ACCRUAL original: post CN → reverses 21-1104 + Cr expense + Cr VAT', async () => {
    const service = buildService();
    // Create + post original ACCRUAL
    const original = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [
          { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
        ],
      } as never,
      userId,
    );
    await service.post(original.id, userId);

    // Create CN
    const cn = await service.createCreditNote(
      {
        branchId,
        documentDate: new Date().toISOString(),
        originalDocumentId: original.id,
        reason: 'partial return',
        subtotal: 500,
        vatAmount: 35,
      } as never,
      userId,
    );
    expect(cn.documentType).toBe('CREDIT_NOTE');
    expect(cn.status).toBe(DocumentStatus.DRAFT);

    await service.post(cn.id, userId);
    const after = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: cn.id } });
    expect(after.status).toBe('POSTED');
    expect(after.journalEntryId).not.toBeNull();

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! },
      include: { lines: true },
    });
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('21-1104'); // Reverses AP
    expect(codes).toContain('53-1302'); // Reverses expense
    expect(codes).toContain('11-4101'); // Reverses VAT (Input Tax Credit) — Fix Report P0-1
  });

  it('CN amount cap: cumulative CNs cannot exceed original totalAmount', async () => {
    const service = buildService();
    const original = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [{ category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    await service.post(original.id, userId);

    // First CN: 600
    const cn1 = await service.createCreditNote(
      { branchId, documentDate: new Date().toISOString(), originalDocumentId: original.id, reason: 'r1', subtotal: 600 } as never,
      userId,
    );
    await service.post(cn1.id, userId);

    // Second CN attempting 500 should fail (cap = 1000 - 600 = 400)
    await expect(service.createCreditNote(
      { branchId, documentDate: new Date().toISOString(), originalDocumentId: original.id, reason: 'r2', subtotal: 500 } as never,
      userId,
    )).rejects.toThrow(/เกินยอดที่ลดได้/);

    // 400 should pass exactly
    const cn3 = await service.createCreditNote(
      { branchId, documentDate: new Date().toISOString(), originalDocumentId: original.id, reason: 'r3', subtotal: 400 } as never,
      userId,
    );
    expect(cn3.subtotal.toString()).toBe('400');
  });

  it('CN cross-branch rejected', async () => {
    const service = buildService();
    const original = await service.create(
      { documentType: 'EXPENSE', branchId, documentDate: new Date().toISOString(), priceType: 'EXCLUSIVE', lines: [{ category: '53-1302', quantity: 1, unitPrice: 100, vatPercent: 0, whtPercent: 0 }] } as never,
      userId,
    );
    await service.post(original.id, userId);

    // Create another branch
    const co = await prisma.companyInfo.findFirst();
    const otherBranch = await prisma.branch.create({ data: { name: '__test_branch_other__', companyId: co!.id } });

    await expect(service.createCreditNote(
      { branchId: otherBranch.id, documentDate: new Date().toISOString(), originalDocumentId: original.id, reason: 'cross', subtotal: 50 } as never,
      userId,
    )).rejects.toThrow(/สาขาเดียวกัน/);
  });
});
