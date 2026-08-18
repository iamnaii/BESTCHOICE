/**
 * I-2 golden (review 2026-08-16) — ยกเลิกใบเสร็จงวดสุดท้าย ต้องคืนเงินเข้าถังเดิม.
 *
 * Runner: vitest (DB-backed). jest ignores `*.integration.spec.ts` globally
 * (apps/api/package.json testPathIgnorePatterns), and this directory is already
 * covered by the CI vitest step's `PAYMENTS_FILES` glob
 * (`src/modules/payments/services/*.integration.spec.ts` in deploy-gcp.yml) —
 * no workflow change needed.
 * Run: cd apps/api && npx vitest run --no-file-parallelism \
 *        src/modules/payments/services/park-void-restore.integration.spec.ts
 *
 * The defect this locks down: a receipt on the contract's LAST installment can
 * consume BOTH advance buckets, and both post to the SAME GL account, so the
 * receipt JE carries ONE merged `Dr 21-1103` line. `ReceiptVoidService` restores
 * that debit into a CONTRACT COLUMN — before the fix it dumped the whole thing
 * into the FIFO `Contract.advanceBalance`, converting parked reschedule-fee money
 * into money the very next 2A accrual would eat into the WRONG installment. That
 * is precisely the behaviour the owner's 2026-08-16 directive removes, and
 * void → re-pay is a supported wizard flow.
 *
 * Locked invariants:
 *   1. The orchestrator stamps the split (`genericConsume` / `parkConsume`) on
 *      the receipt JE it just posted.
 *   2. Voiding that receipt returns each portion to ITS OWN column — no
 *      cross-contamination in either direction.
 *   3. A receipt JE WITHOUT the stamp still restores wholly to `advanceBalance`
 *      (forward-only: no pre-feature JE can hold park money) — the legacy path
 *      must not be "fixed" into guessing a split.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, StandardContract } from '../../journal/__tests__/scenario-helpers';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptsService } from '../../receipts/receipts.service';
import { JE_ADVANCE_SPLIT_META } from '../../receipts/services/receipt-void.service';
import { PaymentReceiptOrchestrator } from './payment-receipt-orchestrator';

const prisma = new PrismaClient();
const D = (n: string) => new Decimal(n);

/** PaymentReceiptTemplate's installmentTotal (flat, no last-period residual). */
const INSTALLMENT_TOTAL = '1515.83';
const GENERIC_START = '200.00';
const PARK_START = '354.00';
/** cash = 1515.83 − (200 generic + 354 park) */
const CASH = 961.83;

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000003',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: D('0.0700'),
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
  const email = 'test-park-void-approver@bestchoice-test.internal';
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email,
      password: 'hashed_placeholder',
      name: 'Park Void Approver',
      role: 'ACCOUNTANT',
      isActive: true,
    },
  });
  return created.id;
}

async function cleanLedger(): Promise<void> {
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.loyaltyPoint.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
    select: { contractId: true },
  });
  await prisma.contract.deleteMany({
    where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
  });
}

describe('void of a last-installment receipt restores park money to its OWN bucket (I-2)', () => {
  let c: StandardContract;
  let paymentId: string;
  let recordedById: string;
  let approverId: string;
  let receiptsService: ReceiptsService;
  let orchestrator: PaymentReceiptOrchestrator;

  const readBuckets = async () => {
    const row = await prisma.contract.findUniqueOrThrow({
      where: { id: c.id },
      select: { advanceBalance: true, rescheduleAdvanceBalance: true },
    });
    return {
      generic: new Decimal(row.advanceBalance.toString()).toFixed(2),
      park: new Decimal(row.rescheduleAdvanceBalance.toString()).toFixed(2),
    };
  };

  /** Latest non-voided INSTALLMENT receipt for the payment under test. */
  const latestReceiptId = async () =>
    (
      await prisma.receipt.findFirstOrThrow({
        where: { paymentId, receiptType: 'INSTALLMENT', isVoided: false, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      })
    ).id;

  beforeAll(async () => {
    await cleanLedger();
    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    await ensureSystemAdminUser();
    approverId = await ensureApprover();

    const journal = new JournalAutoService(prisma as never);
    const receiptTemplate = new PaymentReceiptTemplate(journal, prisma as never);
    receiptsService = new ReceiptsService(
      prisma as never,
      journal,
      new ReceiptVoidReversalTemplate(journal, prisma as never),
      undefined,
    );

    const noop = async () => {};
    orchestrator = new PaymentReceiptOrchestrator(
      prisma as never,
      receiptsService,
      { logPaymentEvent: noop, log: noop } as never,
      journal,
      { transferOwnership: noop } as never,
      { reverseStageOnPayment: noop } as never,
      receiptTemplate,
      { execute: noop } as never,
      {
        awardLoyaltyPoints: noop,
        sendPaymentSuccessLine: noop,
        runMdmAutoUnlock: noop,
        checkPromiseAfterPayment: noop,
      },
    );

    c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as never).execute(c.id);

    recordedById = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'test-salesperson@bestchoice-test.internal' },
      })
    ).id;

    // Installment #11 stays PENDING so paying #12 does NOT complete the contract
    // (a COMPLETED contract is un-voidable — UNPAY_BLOCKED_CONTRACT_STATUSES).
    // Both Payment rows are dated in the FUTURE so no late fee enters the math.
    for (const installmentNo of [11, 12]) {
      const row = await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo,
          dueDate: new Date('2027-06-01'),
          amountDue: D(INSTALLMENT_TOTAL),
          status: 'PENDING',
        },
      });
      if (installmentNo === 12) paymentId = row.id;
    }

    // Accrue #12 BEFORE funding the buckets — a 2A accrual on the LAST
    // installment would otherwise consume the park itself (that path is the 2A
    // template's own tested behaviour, not what this spec is about).
    const sched12 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 12 } },
    });
    await new InstallmentAccrual2ATemplate(journal, prisma as never).execute(sched12.id);

    await prisma.contract.update({
      where: { id: c.id },
      data: {
        advanceBalance: D(GENERIC_START),
        rescheduleAdvanceBalance: D(PARK_START),
      },
    });
  });

  afterAll(async () => {
    await cleanLedger();
    await prisma.$disconnect();
  });

  it('receipt on the LAST installment consumes both buckets and stamps the split on its JE', async () => {
    await orchestrator.recordPayment(
      c.id,
      12,
      CASH,
      'CASH',
      recordedById,
      undefined,
      undefined,
      'PARK-VOID-1',
      '11-1101',
    );

    // Both buckets drained by the receipt.
    expect(await readBuckets()).toEqual({ generic: '0.00', park: '0.00' });

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as never,
          { metadata: { path: ['paymentId'], equals: paymentId } } as never,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    const meta = je.metadata as Record<string, unknown>;
    // The stamp is the ONLY thing that can tell the two buckets apart later —
    // the ledger merges them into one Dr 21-1103 line.
    expect(meta[JE_ADVANCE_SPLIT_META.generic]).toBe('200.00');
    expect(meta[JE_ADVANCE_SPLIT_META.park]).toBe('354.00');
    const dr21 = je.lines
      .filter((l) => l.accountCode === '21-1103')
      .reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    expect(dr21.toFixed(2)).toBe('554.00');
  });

  it('voiding it returns 200 to advanceBalance and 354 to rescheduleAdvanceBalance — no cross-contamination', async () => {
    const receiptId = await latestReceiptId();
    const result = await receiptsService.voidReceipt(
      receiptId,
      'ทดสอบยกเลิกใบเสร็จงวดสุดท้าย (park)',
      recordedById,
      approverId,
      'OWNER',
    );
    expect(result.paymentReverted?.toStatus).toBe('PENDING');

    // THE assertion: before the fix this was { generic: '554.00', park: '0.00' }
    // — 354 of the customer's parked reschedule fee laundered into the FIFO
    // bucket, where the next accrual would eat it into the wrong installment.
    expect(await readBuckets()).toEqual({ generic: GENERIC_START, park: PARK_START });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'RECEIPT_VOID', entity: 'receipt', entityId: receiptId },
      orderBy: { createdAt: 'desc' },
    });
    const nv = audit.newValue as Record<string, string | null>;
    expect(new Decimal(nv.advanceBalanceRestored as string).toFixed(2)).toBe('200.00');
    expect(new Decimal(nv.rescheduleAdvanceRestored as string).toFixed(2)).toBe('354.00');
  });

  it('a receipt JE WITHOUT the split stamp still restores wholly to advanceBalance (forward-only legacy path)', async () => {
    // Re-pay the same installment (buckets are back at 200 / 354 after the void).
    await orchestrator.recordPayment(
      c.id,
      12,
      CASH,
      'CASH',
      recordedById,
      undefined,
      undefined,
      'PARK-VOID-2',
      '11-1101',
    );
    expect(await readBuckets()).toEqual({ generic: '0.00', park: '0.00' });

    // Simulate a JE posted BEFORE this feature shipped: strip the stamp.
    // Filtered in JS, not SQL: a Postgres JSON-path equality on a MISSING key
    // yields NULL, so a SQL NOT(...) would drop the never-reversed rows too
    // (the same trap receipt-void.service.ts documents).
    const jes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as never,
          { metadata: { path: ['paymentId'], equals: paymentId } } as never,
        ],
        deletedAt: null,
      },
    });
    const je = jes.filter((e) => (e.metadata as Record<string, unknown>).reversed !== true)[0];
    expect(je).toBeDefined();
    const stripped = { ...(je.metadata as Record<string, unknown>) };
    delete stripped[JE_ADVANCE_SPLIT_META.generic];
    delete stripped[JE_ADVANCE_SPLIT_META.park];
    await prisma.journalEntry.update({
      where: { id: je.id },
      data: { metadata: stripped as never },
    });

    await receiptsService.voidReceipt(
      await latestReceiptId(),
      'ทดสอบยกเลิกใบเสร็จแบบไม่มี stamp (legacy)',
      recordedById,
      approverId,
      'OWNER',
    );

    // Whole 554 back to the generic bucket — CORRECT for an unstamped JE: the
    // park column did not exist when such a JE could have been posted, so it
    // cannot contain park money. The void must not guess a split.
    expect(await readBuckets()).toEqual({ generic: '554.00', park: '0.00' });
  });
});
