import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseAccountingPermissions } from '../../../utils/accounting-permissions';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';
import { ExpenseDocumentLifecycleService } from '../services/expense-document-lifecycle.service';
import { StatusTransitionService } from '../services/status-transition.service';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('Expense post and void — distinct journal references (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const fixtureId = randomUUID();
  let actorId: string;
  let branchId: string;
  let documentId: string;
  let lifecycle: ExpenseDocumentLifecycleService;
  const configBefore = new Map<string, { value: string; deletedAt: Date | null } | null>();
  const changedConfig = {
    approval_enabled: 'false',
    ATTACHMENT_REQUIRED_ABOVE_AMOUNT: '0',
    reverse_reasons: JSON.stringify([{ code: 'data_entry_error', label: 'บันทึกข้อมูลผิด' }]),
  };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const isTestDatabase = url.pathname === '/test_db' || url.pathname.endsWith('_test');
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !isTestDatabase) {
      throw new Error('This regression requires a disposable local PostgreSQL test database');
    }
    await prisma.$connect();
    const shop = await prisma.companyInfo.upsert({
      where: { companyCode: 'SHOP' }, update: {},
      create: {
        companyCode: 'SHOP', nameTh: 'TEST SHOP', taxId: '0000000000002',
        address: 'TEST', directorName: 'TEST', vatRegistered: false,
      },
    });
    await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' }, update: {},
      create: { email: 'admin@bestchoice.com', password: 'unused', name: 'TEST SYSTEM', role: 'OWNER' },
    });
    for (const account of [
      { code: '53-1404', name: 'TEST expense', type: 'ค่าใช้จ่าย', normalBalance: 'Dr' },
      { code: '11-4101', name: 'TEST input VAT', type: 'สินทรัพย์', normalBalance: 'Dr' },
      { code: '11-1101', name: 'TEST cash', type: 'สินทรัพย์', normalBalance: 'Dr' },
    ]) {
      await prisma.chartOfAccount.upsert({
        where: { code: account.code }, update: {}, create: { ...account, category: 'TEST' },
      });
    }
    const branch = await prisma.branch.create({ data: { name: `TEST-VOID-${fixtureId}`, companyId: shop.id } });
    branchId = branch.id;
    const actor = await prisma.user.create({ data: {
      email: `expense-void-${fixtureId}@bestchoice.test`, password: 'unused',
      name: 'TEST assigned accountant', role: 'ACCOUNTANT', branchId,
    } });
    actorId = actor.id;
    for (const key of [...Object.keys(changedConfig), 'accounting_permissions']) {
      configBefore.set(key, await prisma.systemConfig.findUnique({
        where: { key }, select: { value: true, deletedAt: true },
      }));
    }
    const assignments = parseAccountingPermissions(configBefore.get('accounting_permissions')?.value);
    assignments[actorId] = ['EXPENSE_POST', 'EXPENSE_CANCEL'];
    for (const [key, value] of Object.entries({
      ...changedConfig, accounting_permissions: JSON.stringify(assignments),
    })) {
      await prisma.systemConfig.upsert({
        where: { key }, update: { value, deletedAt: null }, create: { key, value },
      });
    }
    const journal = new JournalAutoService(prisma);
    // Only the same-day path and reversal path are exercised; both use real journal writers.
    lifecycle = new ExpenseDocumentLifecycleService(
      prisma, new StatusTransitionService(), new ExpenseSameDayTemplate(journal, prisma),
      undefined as never, undefined as never, undefined as never, undefined as never,
      undefined as never, undefined as never, journal,
    );
  }, 30_000);

  afterAll(async () => {
    try {
      if (documentId) {
        const entries = await prisma.journalEntry.findMany({
          where: { OR: [
            { referenceId: { in: [documentId, `${documentId}:reversal`] } },
            { metadata: { path: ['documentId'], equals: documentId } },
          ] }, select: { id: true },
        });
        const journalIds = entries.map((entry) => entry.id);
        await prisma.expenseDocument.deleteMany({ where: { id: documentId } });
        await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: journalIds } } });
        await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: journalIds } } });
        await prisma.journalEntry.deleteMany({ where: { id: { in: journalIds } } });
      }
      if (actorId) {
        // AuditLog rows are immutable; retain their actor while removing active access.
        await prisma.user.updateMany({
          where: { id: actorId }, data: { isActive: false, deletedAt: new Date(), branchId: null },
        });
      }
      if (branchId) await prisma.branch.deleteMany({ where: { id: branchId } });
    } finally {
      try {
        // Shared flags must be restored even if document or actor cleanup fails.
        for (const [key, previous] of configBefore) {
          if (previous) await prisma.systemConfig.update({ where: { key }, data: previous });
          else await prisma.systemConfig.deleteMany({ where: { key } });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
  }, 30_000);

  it('posts and voids with assigned rights, preserves the original, and cannot reverse twice', async () => {
    const document = await prisma.expenseDocument.create({ data: {
      number: `EX-VOID-${fixtureId}`, documentType: 'EXPENSE', branchId,
      documentDate: new Date('2026-05-06T05:00:00.000Z'),
      subtotal: '100.00', vatAmount: '7.00', totalAmount: '107.00', netPayment: '107.00',
      paymentMethod: 'CASH', depositAccountCode: '11-1101', createdById: actorId,
      expenseDetail: { create: { priceType: 'EXCLUSIVE', lines: { create: {
        lineNo: 1, category: '53-1404', description: 'TEST expense reversal', quantity: 1,
        unitPrice: '100.00', vatPercent: '7.00', amountBeforeVat: '100.00', vatAmount: '7.00',
      } } } },
    } });
    documentId = document.id;
    await lifecycle.post(documentId, actorId);
    const posted = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(posted.status).toBe('POSTED');
    const original = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: posted.journalEntryId! }, include: { lines: { orderBy: { id: 'asc' } } },
    });
    expect(original.referenceType).toBe('AUTO');
    expect(original.referenceId).toBe(documentId);
    expect(original.lines).toHaveLength(3);

    const voided = await lifecycle.voidDocument(documentId, actorId, {
      reasonCode: 'data_entry_error', reverseDate: '2026-05-06',
    });
    expect(voided.status).toBe('VOIDED');
    expect(voided.journalEntryId).toBe(original.id);
    const entries = await prisma.journalEntry.findMany({
      where: { referenceType: 'AUTO', referenceId: { in: [documentId, `${documentId}:reversal`] } },
      include: { lines: true },
    });
    expect(entries).toHaveLength(2);
    const reversal = entries.find((entry) => entry.id !== original.id)!;
    expect(reversal.referenceId).toBe(`${documentId}:reversal`);
    expect(reversal.metadata).toMatchObject({
      tag: 'EXPENSE_VOID_REVERSAL', documentId, originalJournalEntryId: original.id,
    });
    for (const entry of entries) {
      expect(entry.status).toBe('POSTED');
      expect(entry.companyId).toBe(original.companyId);
      const debit = entry.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
      const credit = entry.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));
      expect(debit.toFixed(2)).toBe('107.00');
      expect(credit.toFixed(2)).toBe('107.00');
    }
    expect(reversal.lines).toHaveLength(original.lines.length);
    for (const originalLine of original.lines) {
      const reverseLine = reversal.lines.find((line) => line.accountCode === originalLine.accountCode)!;
      expect(reverseLine.debit.toFixed(2)).toBe(originalLine.credit.toFixed(2));
      expect(reverseLine.credit.toFixed(2)).toBe(originalLine.debit.toFixed(2));
    }
    expect(await prisma.journalEntry.findUniqueOrThrow({
      where: { id: original.id }, include: { lines: { orderBy: { id: 'asc' } } },
    })).toEqual(original);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'EXPENSE_VOIDED', entityId: documentId },
    });
    expect(audit.userId).toBe(actorId);
    expect(audit.newValue).toMatchObject({ reverseJournalEntryId: reversal.id });

    await expect(lifecycle.voidDocument(documentId, actorId, {
      reasonCode: 'data_entry_error', reverseDate: '2026-05-06',
    })).rejects.toThrow(/ยกเลิกอยู่แล้ว/);
    expect(await prisma.journalEntry.count({
      where: { referenceType: 'AUTO', referenceId: { in: [documentId, `${documentId}:reversal`] } },
    })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'EXPENSE_VOIDED', entityId: documentId } })).toBe(1);
  }, 30_000);
});
