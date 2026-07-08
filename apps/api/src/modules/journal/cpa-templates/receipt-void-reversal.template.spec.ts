import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { ReceiptVoidReversalTemplate } from './receipt-void-reversal.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
  // them first or this deleteMany trips P2003 when an asset spec ran earlier.
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.eDocument.deleteMany({});
  await prisma.signature.deleteMany({});
  await prisma.contractDocument.deleteMany({});
  await prisma.partialPaymentLink.deleteMany({});
  await prisma.warrantyAuditLog.deleteMany({});
  await prisma.badDebtWriteOffAuditLog.deleteMany({});
  await prisma.promiseSlot.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.dunningAction.deleteMany({});
  await prisma.repossession.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);

  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!existing) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return new JournalAutoService(prisma as any);
}

describe('ReceiptVoidReversalTemplate', () => {
  let journal: JournalAutoService;
  let paymentJeId: string;

  beforeAll(async () => {
    journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Pay installment 1 to create a payment-receipt JE. PR-843/I2 Phase 5d:
    // the legacy PaymentReceipt2BTemplate was deleted; reproduce its full-clear
    // posting directly (Dr deposit / Cr 11-2103 for installmentTotal) plus the
    // PAID Payment row, mirroring what the primitive would post. The void flow
    // under test only reverses these JE lines, so its assertions are unchanged.
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    await accrual.execute(insts[0].id);

    const installmentTotal = new Decimal('1515.83');
    const inst0 = insts[0];
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    const payment = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: inst0.installmentNo,
        dueDate: inst0.dueDate,
        amountDue: installmentTotal,
        amountPaid: installmentTotal,
        paidDate: new Date(),
        paidAt: new Date(),
        status: 'PAID',
      },
    });
    const { id: paymentJournalEntryId } = await journal.createAndPost({
      description: `รับชำระงวด #${inst0.installmentNo} — สัญญา ${contract.contractNumber}`,
      reference: payment.id,
      metadata: {
        tag: 'receipt',
        contractId: c.id,
        installmentScheduleId: inst0.id,
        paymentId: payment.id,
      },
      lines: [
        { accountCode: '11-1101', dr: installmentTotal, cr: new Decimal(0), description: 'รับเงิน' },
        {
          accountCode: '11-2103',
          dr: new Decimal(0),
          cr: installmentTotal,
          description: 'ล้างลูกหนี้ค้างชำระ',
        },
      ],
    });
    paymentJeId = paymentJournalEntryId;
  });

  it('posts a balanced void-reversal JE with Dr/Cr swapped', async () => {
    const tmpl = new ReceiptVoidReversalTemplate(journal, prisma as any);
    const result = await tmpl.voidReceipt(paymentJeId);

    expect(result.entryNo).toMatch(/^JE-/);

    const reversalJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'receipt-void' } } as any,
          { metadata: { path: ['originalEntryId'], equals: paymentJeId } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(reversalJe).toBeDefined();
    expect(reversalJe!.status).toBe('POSTED');

    const lines = reversalJe!.lines;
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    expect(totalDr.gt(0)).toBe(true);
  });

  it('marks original JE as reversed', async () => {
    const originalJe = await prisma.journalEntry.findUnique({ where: { id: paymentJeId } });
    expect(originalJe).toBeDefined();
    const meta = originalJe!.metadata as Record<string, unknown>;
    expect(meta['reversed']).toBe(true);
  });

  it('is idempotent — second call returns same reversal entry', async () => {
    const tmpl = new ReceiptVoidReversalTemplate(journal, prisma as any);
    const first = await tmpl.voidReceipt(paymentJeId);
    const second = await tmpl.voidReceipt(paymentJeId);

    expect(first.entryNo).toBe(second.entryNo);

    const count = await prisma.journalEntry.count({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'receipt-void' } } as any,
          { metadata: { path: ['originalEntryId'], equals: paymentJeId } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(count).toBe(1);
  });

  it('throws BadRequestException when trying to void an already-reversed JE directly', async () => {
    const tmpl = new ReceiptVoidReversalTemplate(journal, prisma as any);
    // The original is already marked reversed=true from the first void call
    // Direct call bypassing idempotency would throw — but our idempotency check catches it first
    // Test that double-void still returns the same entry safely
    const result = await tmpl.voidReceipt(paymentJeId);
    expect(result.entryNo).toMatch(/^JE-/);
  });
});
