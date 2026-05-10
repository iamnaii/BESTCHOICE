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
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let userId: string;
let branchId: string;

describe('Vendor Settlement lifecycle (integration)', () => {
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
      new LineAggregatorService(),
      new JePreviewService(new LineAggregatorService()),
    );
  }

  it('Clears 2 ACCRUAL EXs in one SE → both flip to POSTED', async () => {
    const service = buildService();
    const user = { id: userId, branchId, role: 'OWNER' };
    // Create 2 ACCRUAL EXs (no payment method → ACCRUAL)
    const ex1 = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [{ category: '53-1404', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    const ex2 = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [{ category: '53-1404', quantity: 1, unitPrice: 2000, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    await service.post(ex1.id, userId);
    await service.post(ex2.id, userId);
    // Verify both are ACCRUAL
    const ex1After = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: ex1.id } });
    expect(ex1After.status).toBe('ACCRUAL');

    // Create SE clearing both
    const se = await service.createSettlement(
      {
        branchId,
        documentDate: new Date().toISOString(),
        depositAccountCode: '11-1101',
        lines: [
          { clearedDocumentId: ex1.id, amountSettled: 1000 },
          { clearedDocumentId: ex2.id, amountSettled: 2000 },
        ],
      } as never,
      user,
    );
    await service.post(se.id, userId);

    const seAfter = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: se.id } });
    expect(seAfter.status).toBe(DocumentStatus.POSTED);

    // Both cleared EXs should now be POSTED + paidAt
    const ex1Final = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: ex1.id } });
    const ex2Final = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: ex2.id } });
    expect(ex1Final.status).toBe('POSTED');
    expect(ex1Final.paidAt).not.toBeNull();
    expect(ex2Final.status).toBe('POSTED');

    // JE balanced (Dr 21-1104 = 3000 / Cr cash = 3000)
    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: seAfter.journalEntryId! },
      include: { lines: true },
    });
    const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(drSum).toBeCloseTo(crSum, 2);
    expect(drSum).toBeCloseTo(3000, 2);
  });

  it('Rejects SE with already-POSTED EX in batch', async () => {
    const service = buildService();
    const user = { id: userId, branchId, role: 'OWNER' };
    // Create + post EX as Same-day → POSTED
    const samedayEx = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        lines: [{ category: '53-1302', quantity: 1, unitPrice: 500, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    await service.post(samedayEx.id, userId); // POSTED already

    // Try SE on POSTED → should reject
    await expect(
      service.createSettlement(
        {
          branchId,
          documentDate: new Date().toISOString(),
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: samedayEx.id, amountSettled: 500 }],
        } as never,
        user,
      ),
    ).rejects.toThrow(/ACCRUAL/);
  });

  it('Rejects SE when amountSettled exceeds remaining cap', async () => {
    const service = buildService();
    const user = { id: userId, branchId, role: 'OWNER' };
    // Create fresh ACCRUAL EX with totalAmount 1000
    const ex = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        priceType: 'EXCLUSIVE',
        lines: [{ category: '53-1404', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 }],
      } as never,
      userId,
    );
    await service.post(ex.id, userId); // ACCRUAL

    // Try to settle 1500 (cap is 1000) → reject
    await expect(
      service.createSettlement(
        {
          branchId,
          documentDate: new Date().toISOString(),
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: ex.id, amountSettled: 1500 }],
        } as never,
        user,
      ),
    ).rejects.toThrow(/เกินยอดที่ค้าง/);
  });
});
