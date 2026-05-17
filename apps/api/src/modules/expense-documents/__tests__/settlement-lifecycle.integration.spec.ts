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
      // D1.1.2.4 — DocNumberService now takes SettingsService; integration
      // tests pass a stub that returns null (→ sequence-table flag = false).
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

  // ── B2 / K-07 — Settlement with Multi-line Adjustment ──────────────
  // Clear 1000฿ AP, take 20฿ early-payoff discount → actual cash leg = 980.
  // V12: signedSum(CR 52-1106: 20) = +20 = amountPaid(980) − netExpected(1000)
  it('B2 / K-07: SE with discount adjustment posts balanced JE (Dr AP / Cr cash + Cr 52-1106)', async () => {
    const service = buildService();
    const user = { id: userId, branchId, role: 'OWNER' };
    // Create fresh ACCRUAL EX of 1000฿
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
    await service.post(ex.id, userId); // → ACCRUAL

    // Settlement with 20฿ discount adjustment
    const se = await service.createSettlement(
      {
        branchId,
        documentDate: new Date().toISOString(),
        depositAccountCode: '11-1101',
        lines: [{ clearedDocumentId: ex.id, amountSettled: 1000 }],
        amountPaid: '980',
        adjustments: [
          { accountCode: '52-1106', side: 'CR', amount: '20', note: 'ส่วนลดปิดยอดก่อนกำหนด' },
        ],
      } as never,
      user,
    );
    await service.post(se.id, userId);

    const seAfter = await prisma.expenseDocument.findUniqueOrThrow({
      where: { id: se.id },
      include: { adjustments: true },
    });
    expect(seAfter.status).toBe(DocumentStatus.POSTED);
    expect(seAfter.netPayment?.toString()).toBe('980');
    expect(seAfter.adjustments).toHaveLength(1);
    expect(seAfter.adjustments[0].accountCode).toBe('52-1106');
    expect(seAfter.adjustments[0].side).toBe('CR');

    // Balanced JE — Dr 21-1104 = 1000 / Cr cash 980 + Cr 52-1106 20 = 1000
    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: seAfter.journalEntryId! },
      include: { lines: true },
    });
    const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(drSum).toBeCloseTo(crSum, 2);
    expect(drSum).toBeCloseTo(1000, 2);

    const apLine = je.lines.find((l) => l.accountCode === '21-1104');
    const cashLine = je.lines.find((l) => l.accountCode === '11-1101');
    const discountLine = je.lines.find((l) => l.accountCode === '52-1106');
    expect(Number(apLine!.debit)).toBeCloseTo(1000, 2);
    expect(Number(cashLine!.credit)).toBeCloseTo(980, 2);
    expect(Number(discountLine!.credit)).toBeCloseTo(20, 2);

    // EX is fully cleared → POSTED
    const exAfter = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: ex.id } });
    expect(exAfter.status).toBe('POSTED');
  });

  it('B2 / K-07 negative: SE with adjustments that violate V12 rejects', async () => {
    const service = buildService();
    const user = { id: userId, branchId, role: 'OWNER' };
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
    await service.post(ex.id, userId);

    // amountPaid = 980 but adjustment only sums to +10 (not the required +20)
    await expect(
      service.createSettlement(
        {
          branchId,
          documentDate: new Date().toISOString(),
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: ex.id, amountSettled: 1000 }],
          amountPaid: '980',
          adjustments: [
            { accountCode: '52-1106', side: 'CR', amount: '10' },
          ],
        } as never,
        user,
      ),
    ).rejects.toThrow(/V12/);
  });

  it('B2 / K-07 disallowed code: SE with adjustment outside ADJUSTMENT_ALLOWLIST rejects', async () => {
    const service = buildService();
    const user = { id: userId, branchId, role: 'OWNER' };
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
    await service.post(ex.id, userId);

    // Try to route the discount to a Revenue account (would balance arithmetically
    // but violate accounting policy — V13 must reject).
    await expect(
      service.createSettlement(
        {
          branchId,
          documentDate: new Date().toISOString(),
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: ex.id, amountSettled: 1000 }],
          amountPaid: '980',
          adjustments: [
            { accountCode: '41-1101', side: 'CR', amount: '20' },
          ],
        } as never,
        user,
      ),
    ).rejects.toThrow(/V13|allow/i);
  });
});
