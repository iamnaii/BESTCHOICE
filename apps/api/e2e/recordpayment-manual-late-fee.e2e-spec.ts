/**
 * Real PaymentsService/receipts/audit/JE regression for explicit fee additions.
 * Run against the isolated local payment database or CI's disposable test_db.
 * Every variant owns its contract/payment/receipt/JE rows; cleanup is scoped.
 */
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProductsService } from '../src/modules/products/products.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../src/modules/journal/cpa-templates/vat-60day-reversal.template';
import { BadDebtService } from '../src/modules/accounting/bad-debt.service';
import { BadDebtProvisionTemplate } from '../src/modules/journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../src/modules/journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../src/modules/journal/cpa-templates/ecl-stage-reverse.template';
import { ConsecutiveMissedService } from '../src/modules/overdue/consecutive-missed.service';
import { CreditNoteDocumentService } from '../src/modules/receipts/services/credit-note-document.service';
import { ReceiptVoidReversalTemplate } from '../src/modules/journal/cpa-templates/receipt-void-reversal.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

import { InstallmentAccrual2ATemplate } from '../src/modules/journal/cpa-templates/installment-accrual-2a.template';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const D = (value: string | number) => new Prisma.Decimal(value);
const bracketConfig = [
  ['late_fee_tier1_amount', '50'],
  ['late_fee_tier2_amount', '100'],
  ['late_fee_tier2_min_days', '3'],
] as const;

describeWithDatabase('explicit late fee after a partial receipt (real PostgreSQL)', () => {
  let prisma: PrismaService;
  let payments: PaymentsService;
  let receipts: ReceiptsService;
  let journal: JournalAutoService;
  let adminId: string;
  const contractIds: string[] = [];
  const configBefore = new Map<string, string | null>();

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['/bc_payment_integration_test', '/test_db'].includes(url.pathname)) {
      throw new Error('Use only the disposable payment database or CI test_db for this e2e');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    await seedFinanceCoa(prisma as any);
    const admin = await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' }, update: {},
      create: { email: 'admin@bestchoice.com', password: 'test-only', name: 'Test Admin', role: 'OWNER' },
    });
    adminId = admin.id;
    if (!(await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null } }))) {
      await prisma.companyInfo.create({ data: {
        companyCode: 'FINANCE', nameTh: 'Disposable E2E Finance', taxId: '9999999999999',
        address: 'Test only', directorName: 'Test Director', vatRegistered: true, vatRate: '0.0700',
      } });
    }
    for (const [key, value] of bracketConfig) {
      const previous = await prisma.systemConfig.findUnique({ where: { key } });
      configBefore.set(key, previous?.value ?? null);
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    journal = new JournalAutoService(prisma as any);
    receipts = new ReceiptsService(prisma as any, journal,
      new ReceiptVoidReversalTemplate(journal, prisma as any), undefined);
    const badDebt = new BadDebtService(
      prisma as any, journal,
      new BadDebtProvisionTemplate(journal, prisma as any),
      new BadDebtWriteOffTemplate(journal, prisma as any),
      new EclStageReverseTemplate(journal, prisma as any),
      new ConsecutiveMissedService(prisma as any),
      new CreditNoteDocumentService(prisma as any),
      { deliver: async () => ({ delivered: true }) } as any,
    );
    payments = new PaymentsService(
      prisma as any, receipts, new AuditService(prisma as any), journal, new ProductsService(prisma as any),
      { sendFlexMessage: async () => undefined } as any,
      { paymentReceipt: () => ({ quickReply: undefined }) } as any,
      { afterPayment: () => [] } as any, badDebt,
      new PaymentReceiptTemplate(journal, prisma as any), new Vat60dayReversalTemplate(journal, prisma as any),
      undefined, undefined, undefined, undefined,
    );
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    try {
      if (contractIds.length) {
        const entries = await prisma.journalEntry.findMany({
          where: { OR: [
            { referenceId: { in: contractIds } },
            ...contractIds.map(id => ({ metadata: { path: ['contractId'], equals: id } })),
          ] }, select: { id: true },
        });
        const entryIds = entries.map(e => e.id);
        // Exact receipt-source links must be removed BEFORE their journal rows.
        await prisma.receipt.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.paymentDraft.deleteMany({ where: { payment: { contractId: { in: contractIds } } } });
        await prisma.loyaltyPoint.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.partialPaymentLink.deleteMany({ where: { payment: { contractId: { in: contractIds } } } });
        await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: entryIds } } });
        await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
        await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
        await prisma.payment.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
        // Immutable audit logs are deliberately retained in this disposable DB.
      }
    } finally {
      for (const [key, value] of configBefore) {
        if (value === null) await prisma.systemConfig.deleteMany({ where: { key } });
        else await prisma.systemConfig.update({ where: { key }, data: { value } });
      }
      await prisma.$disconnect();
    }
  }, 120_000);

  it.each([
    { label: 'ordinary follow-up', additionalLateFee: 0, draft: false },
    { label: 'explicit additional 50', additionalLateFee: 50, draft: false },
    { label: 'draft then post additional 50', additionalLateFee: 50, draft: true },
  ])('$label preserves both actual receipt fee allocations', async ({ additionalLateFee, draft }) => {
    await prisma.systemConfig.update({ where: { key: 'late_fee_tier2_amount' }, data: { value: '100' } });
    const c = await seedStandard17k12m(prisma as any);
    contractIds.push(c.id);
    await prisma.contract.update({ where: { id: c.id }, data: { monthlyPayment: D('1515.83') } });
    const dueDate = new Date(Date.now() - 5 * 86_400_000);
    const schedule = await prisma.installmentSchedule.update({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 1 } }, data: { dueDate },
    });
    const payment = await prisma.payment.create({ data: {
      contractId: c.id, installmentNo: 1, amountDue: D('1515.83'), amountPaid: D(0),
      lateFee: D(0), lateFeeWaived: false, status: 'PENDING', dueDate,
    } });
    // Leave a later installment unpaid: this scenario closes only installment 1.
    await prisma.payment.create({ data: {
      contractId: c.id, installmentNo: 2, amountDue: D('1515.83'), amountPaid: D(0),
      status: 'PENDING', dueDate: new Date(Date.now() + 30 * 86_400_000),
    } });
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
    await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(schedule.id);

    const firstRef = `manual-fee-first-${randomUUID()}`;
    await payments.recordPayment(
      c.id, 1, 800, 'BANK_TRANSFER', adminId, 'https://example.test/first.jpg',
      undefined, firstRef, '11-1101', undefined, 'PARTIAL',
    );
    const afterFirst = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(afterFirst.status).toBe('PARTIALLY_PAID');
    expect(afterFirst.amountPaid.toFixed(2)).toBe('800.00');
    expect(afterFirst.lateFee.toFixed(2)).toBe('100.00');
    const firstReceipt = await prisma.receipt.findFirstOrThrow({ where: { contractId: c.id, transactionRef: firstRef } });
    expect(firstReceipt.sourceJournalEntryId).not.toBeNull();
    expect((await receipts.getReceipt(firstReceipt.id)).lateFeeCollected).toBe('100.00');

    // A changed automatic bracket must not charge the follow-up receipt again.
    await prisma.systemConfig.update({ where: { key: 'late_fee_tier2_amount' }, data: { value: '250' } });
    const secondAmount = D('815.83').plus(additionalLateFee);
    const secondRef = `manual-fee-second-${randomUUID()}`;
    const preview = await payments.previewJournal({
      contractId: c.id, installmentNo: 1, amountReceived: secondAmount.toNumber(),
      depositAccountCode: '11-1101', lateFee: 100 + additionalLateFee, case: 'NORMAL',
    });
    expect(preview.isBalanced).toBe(true);
    expect(preview.lines.find(l => l.accountCode === '42-1103')?.credit ?? '0.00')
      .toBe(D(additionalLateFee).toFixed(2));

    if (draft) {
      const entryCount = await prisma.journalEntry.count({ where: { metadata: { path: ['contractId'], equals: c.id } } });
      const saved = await payments.saveDraft(c.id, 1, {
        amount: secondAmount.toNumber(), paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1101',
        lateFee: 100 + additionalLateFee, additionalLateFee, paymentCase: 'NORMAL', consumeAdvance: true,
        evidenceUrl: 'https://example.test/second.jpg', transactionRef: secondRef,
      }, adminId);
      expect(saved.additionalLateFee?.toFixed(2)).toBe('50.00');
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).lateFee.toFixed(2)).toBe('100.00');
      expect(await prisma.journalEntry.count({ where: { metadata: { path: ['contractId'], equals: c.id } } })).toBe(entryCount);
      await payments.postDraft(payment.id, adminId);
      expect(await payments.getDraft(payment.id)).toBeNull();
    } else {
      await payments.recordPayment(
        c.id, 1, secondAmount.toNumber(), 'BANK_TRANSFER', adminId, 'https://example.test/second.jpg',
        undefined, secondRef, '11-1101', undefined, 'NORMAL', true, undefined,
        undefined, undefined, undefined, true, additionalLateFee,
      );
    }
    const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalPayment.status).toBe('PAID');
    expect(finalPayment.lateFee.toFixed(2)).toBe(D(100).plus(additionalLateFee).toFixed(2));
    expect(finalPayment.amountPaid.toFixed(2)).toBe(D('1615.83').plus(additionalLateFee).toFixed(2));

    const documents = await receipts.getContractReceipts(c.id);
    expect(documents).toHaveLength(2);
    const first = documents.find(r => r.transactionRef === firstRef)!;
    const second = documents.find(r => r.transactionRef === secondRef)!;
    expect(first.lateFeeCollected).toBe('100.00'); // unchanged after the cumulative fee grew
    expect(second.lateFeeCollected).toBe(D(additionalLateFee).toFixed(2));
    expect(first.lateFeeWaivedThisReceipt).toBe('0.00');
    expect(second.lateFeeWaivedThisReceipt).toBe('0.00');
    expect(first.sourceJournalEntryId).not.toBe(second.sourceJournalEntryId);
    expect(second.sourceJournalEntryId).not.toBeNull();
    const source = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: second.sourceJournalEntryId! }, include: { lines: true },
    });
    expect(source.metadata).toMatchObject({ tag: 'receipt', contractId: c.id, paymentId: payment.id });
    expect(source.lines.filter(l => l.accountCode === '42-1103')
      .reduce((sum, l) => sum.plus(l.credit), D(0)).toFixed(2)).toBe(D(additionalLateFee).toFixed(2));
    expect(source.lines.filter(l => l.accountCode === '11-2103')
      .reduce((sum, l) => sum.plus(l.credit), D(0)).toFixed(2)).toBe('815.83');
    expect((await receipts.getReceipt(first.id)).lateFeeCollected).toBe('100.00');
    expect((await receipts.getReceipt(second.id)).lateFeeCollected).toBe(D(additionalLateFee).toFixed(2));
  }, 120_000);
});
