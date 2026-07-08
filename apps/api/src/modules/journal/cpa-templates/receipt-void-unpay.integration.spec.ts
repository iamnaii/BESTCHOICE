/**
 * P0 golden — ยกเลิกใบเสร็จ = ยกเลิกการชำระทั้งงวด (un-pay, 2026-07-08).
 *
 * Runner: vitest (DB-backed; cpa-templates *.spec.ts are jest-ignored per
 * package.json testPathIgnorePatterns — same gating as
 * reschedule-collect-lifecycle.integration.spec.ts). Runs BLOCKING in the CI
 * money-invariant step (deploy-gcp.yml #1328/#1334).
 * Run:    cd apps/api && npx vitest run --no-file-parallelism \
 *           src/modules/journal/cpa-templates/receipt-void-unpay.integration.spec.ts
 *
 * Lifecycle under test (owner decision 2026-07-08 — supersedes the 2026-06-07
 * "void keeps payment PAID" note):
 *   1. Standard 17k/12m contract, 1A activation, 2A accrual for installment #1
 *      (Dr 11-2103 1,515.83).
 *   2. Full receipt 1,515.83 via the primitive + orchestrator-equivalent Payment
 *      write (status PAID) + e-Receipt row.
 *   3. ReceiptsService.voidReceipt → must atomically: reverse the receipt JE
 *      (mirror Dr 11-2103 / Cr cash), stamp the original metadata.reversed=true,
 *      create the CREDIT_NOTE row, revert the Payment to OVERDUE/0/null, and
 *      write the RECEIPT_VOID audit with the paymentReverted trail.
 *   4. Re-receipt of the SAME installment must succeed — reconstructPriorCleared
 *      skips reversed originals, so the primitive must NOT throw
 *      "งวดนี้ถูกชำระครบแล้ว" (the pre-fix failure mode).
 *
 * Money-critical invariants:
 *   Net 11-2103 (Dr − Cr) across ALL JEs == 0 (accrued once, cleared once —
 *   the void+re-receipt pair nets out), and net cash Dr 11-1101 == 1,515.83
 *   (money received exactly once after the voided receipt is reversed).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, StandardContract } from '../__tests__/scenario-helpers';
import { JournalAutoService } from '../journal-auto.service';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { PaymentReceiptTemplate } from './payment-receipt.template';
import { ReceiptVoidReversalTemplate } from './receipt-void-reversal.template';
import { ReceiptsService } from '../../receipts/receipts.service';
import { reconstructPriorCleared } from '../reconstruct-prior';

const prisma = new PrismaClient();
const D = (n: string) => new Decimal(n);

const INSTALLMENT_TOTAL = D('1515.83');

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000002',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: new Decimal('0.0700'),
      },
    });
  }
}

/** JournalAutoService.resolveSystemUserId requires admin@bestchoice.com. */
async function ensureSystemAdminUser(): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: 'admin@bestchoice.com',
        password: 'hashed_placeholder',
        name: 'System Admin',
        role: 'OWNER',
      },
    });
  }
}

/** SoD: voidReceipt needs an approver ≠ requester with a void-capable role. */
async function ensureApprover(): Promise<string> {
  const email = 'test-void-approver@bestchoice-test.internal';
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email,
      password: 'hashed_placeholder',
      name: 'Void Approver',
      role: 'ACCOUNTANT',
      isActive: true,
    },
  });
  return created.id;
}

describe('receipt void un-pays the installment → re-receipt succeeds (integration)', () => {
  let c: StandardContract;
  let sched1Id: string;
  let paymentId: string;
  let receiptId: string;
  let recordedById: string;
  let approverId: string;
  let receiptsService: ReceiptsService;
  let tpl: PaymentReceiptTemplate;

  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.loyaltyPoint.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    await ensureSystemAdminUser();
    approverId = await ensureApprover();

    const journal = new JournalAutoService(prisma as any);
    tpl = new PaymentReceiptTemplate(journal, prisma as any);
    receiptsService = new ReceiptsService(
      prisma as any,
      journal,
      new ReceiptVoidReversalTemplate(journal, prisma as any),
      undefined,
    );

    c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const sched1 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 1 } },
    });
    sched1Id = sched1.id;

    recordedById = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'test-salesperson@bestchoice-test.internal' },
      })
    ).id;

    // Payment IS the installment — overdue row for #1 (due 2025-02-01 per seed).
    const payment = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 1,
        dueDate: sched1.dueDate,
        amountDue: D('1515.83'),
        status: 'OVERDUE',
      },
    });
    paymentId = payment.id;

    // Accrue the receivable (Dr 11-2103 1,515.83) like the nightly 2A cron.
    await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(sched1Id);

    // ── Step 2: pay the installment in full ────────────────────────────────
    await tpl.execute({
      installmentScheduleId: sched1Id,
      delta: INSTALLMENT_TOTAL,
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
      paymentId,
    });
    // Orchestrator-equivalent Payment write (the primitive is JE-only).
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'PAID',
        amountPaid: D('1515.83'),
        paidDate: new Date(),
        paymentMethod: 'CASH',
        recordedById,
      },
    });
    const receipt = await receiptsService.generateReceipt(
      c.id,
      paymentId,
      'INSTALLMENT',
      1515.83,
      1,
      'CASH',
      null,
      recordedById,
    );
    receiptId = receipt.id;
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.loyaltyPoint.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.$disconnect();
  });

  it('void reverses the ledger, reverts the Payment to OVERDUE/0/null, voids the receipt + writes the audit trail', async () => {
    const result = await receiptsService.voidReceipt(
      receiptId,
      'ทดสอบยกเลิกการชำระ',
      recordedById,
      approverId,
      'OWNER',
    );
    expect(result.creditNote.receiptType).toBe('CREDIT_NOTE');
    expect(result.paymentReverted).toMatchObject({
      paymentId,
      fromStatus: 'PAID',
      toStatus: 'OVERDUE', // due 2025-02-01 < now → back to ค้างชำระ immediately
    });

    // Payment un-paid — reappears in the pending queue (status filter).
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(pay.status).toBe('OVERDUE');
    expect(new Decimal(pay.amountPaid.toString()).toFixed(2)).toBe('0.00');
    expect(pay.paidDate).toBeNull();

    // Receipt voided; credit note references it.
    const voided = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(voided.isVoided).toBe(true);
    const cn = await prisma.receipt.findFirstOrThrow({
      where: { receiptType: 'CREDIT_NOTE', voidedReceiptId: receiptId },
    });
    expect(new Decimal(cn.amount.toString()).toFixed(2)).toBe('1515.83');

    // Original receipt JE stamped reversed=true + a mirror REVERSAL JE posted.
    const receiptJe = await prisma.journalEntry.findFirstOrThrow({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched1Id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect((receiptJe.metadata as any).reversed).toBe(true);
    const reversalJe = await prisma.journalEntry.findFirstOrThrow({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'REVERSAL' } } as any,
          { metadata: { path: ['originalEntryId'], equals: receiptJe.id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    const dr112103 = reversalJe.lines.find((l) => l.accountCode === '11-2103');
    expect(new Decimal(dr112103!.debit.toString()).toFixed(2)).toBe('1515.83');

    // reconstructPriorCleared no longer counts the reversed original.
    const prior = await reconstructPriorCleared(prisma, sched1Id, INSTALLMENT_TOTAL);
    expect(prior.priorPrincipalCleared.toFixed(2)).toBe('0.00');

    // Forensic audit carries the un-pay trail.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'RECEIPT_VOID', entity: 'receipt', entityId: receiptId },
      orderBy: { createdAt: 'desc' },
    });
    const nv = audit.newValue as Record<string, any>;
    expect(nv.paymentReverted?.toStatus).toBe('OVERDUE');
  });

  it('re-receipt of the voided installment succeeds — the pre-fix path threw "งวดนี้ถูกชำระครบแล้ว"', async () => {
    const { split } = await tpl.execute({
      installmentScheduleId: sched1Id,
      delta: INSTALLMENT_TOTAL,
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
      paymentId,
    });
    expect(split.principalCleared.toFixed(2)).toBe('1515.83');
    expect(split.principalRemainingAfter.toFixed(2)).toBe('0.00');

    // ── Money-critical invariants across ALL JEs ───────────────────────────
    const entries = await prisma.journalEntry.findMany({
      where: { deletedAt: null },
      include: { lines: true },
    });
    const net = (code: string) =>
      entries
        .flatMap((e) => e.lines)
        .filter((l) => l.accountCode === code)
        .reduce(
          (s, l) =>
            s.plus(new Decimal(l.debit.toString())).minus(new Decimal(l.credit.toString())),
          new Decimal(0),
        );
    // Receivable accrued once and cleared once — void + re-receipt net out.
    expect(net('11-2103').toFixed(2)).toBe('0.00');
    // Cash received exactly once (receipt − void reversal + re-receipt).
    expect(net('11-1101').toFixed(2)).toBe('1515.83');
  });

  it('SECOND void (after the re-pay) succeeds — reversal targeting must skip already-reversed originals', async () => {
    // Pre-fix failure mode: the JE-matching query found the FIRST cycle's
    // receipt JE again (status stays POSTED; only metadata.reversed flips) and
    // ReceiptVoidReversalTemplate threw "already reversed", bricking every
    // void after a void → re-pay cycle.
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'PAID', amountPaid: D('1515.83'), paidDate: new Date() },
    });
    const receipt2 = await receiptsService.generateReceipt(
      c.id,
      paymentId,
      'INSTALLMENT',
      1515.83,
      1,
      'CASH',
      null,
      recordedById,
    );

    const result = await receiptsService.voidReceipt(
      receipt2.id,
      'ทดสอบยกเลิกรอบสอง',
      recordedById,
      approverId,
      'OWNER',
    );
    expect(result.paymentReverted?.toStatus).toBe('OVERDUE');

    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(pay.status).toBe('OVERDUE');
    expect(new Decimal(pay.amountPaid.toString()).toFixed(2)).toBe('0.00');

    // Ledger nets back to "accrued, never cleared": both receipts reversed.
    const entries = await prisma.journalEntry.findMany({
      where: { deletedAt: null },
      include: { lines: true },
    });
    const net = (code: string) =>
      entries
        .flatMap((e) => e.lines)
        .filter((l) => l.accountCode === code)
        .reduce(
          (s, l) =>
            s.plus(new Decimal(l.debit.toString())).minus(new Decimal(l.credit.toString())),
          new Decimal(0),
        );
    expect(net('11-2103').toFixed(2)).toBe('1515.83'); // receivable re-opened
    expect(net('11-1101').toFixed(2)).toBe('0.00'); // no cash held
  });
});
