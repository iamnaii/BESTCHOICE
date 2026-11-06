/**
 * Late-fee waivers are GL-aware — DB-backed, real receipt journal entries.
 *
 * Runner: vitest (DB-backed). jest ignores `*.integration.spec.ts`; the CI vitest
 * step's `PAYMENTS_FILES` glob (`src/modules/payments/services/*.integration.spec.ts`
 * in deploy-gcp.yml) already covers this directory.
 * Run: cd apps/api && npx vitest run --no-file-parallelism \
 *        src/modules/payments/services/late-fee-waiver-settlement.integration.spec.ts
 *
 * The defect this locks down: receipts allocate cash FEE FIRST (split-receipt.ts),
 * so Payment.amountPaid mixes fee and principal. Both standalone waiver paths
 * used to read it as principal:
 *   - payment-approval waiver (payments/services/late-fee-waiver.service.ts)
 *     flipped the row PAID on `amountPaid ≥ amountDue` → a 1,515.83 receipt that
 *     booked Cr 42-1103 100 + Cr 11-2103 1,415.83 became PAID (and completed the
 *     contract, releasing the device) while 11-2103 still carried 100;
 *   - collector request → approve (late-fee-waiver module) waived the FULL fee
 *     even when part of it was already income, zeroed lateFee (so the remaining
 *     principal could no longer be collected) and never settled anything.
 *
 * Every receipt below goes through PaymentReceiptOrchestrator.recordPayment →
 * PaymentReceiptTemplate (no amountPaid seeding), except the explicitly-labelled
 * legacy row (c), which has no receipt journal entry by definition.
 *
 * Path 1 note: the payment-approval controller refuses to CREATE a WAIVE_LATE_FEE
 * request once amountPaid > 0 (payment-approval.controller.ts) — so in production
 * that path only sees unpaid rows. The partially-paid cases pin the service-level
 * invariant with a request row built from the same snapshot the controller stores
 * (`paymentApprovalSnapshot`) and consumed through the real `consumePaymentApproval`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { reconstructPriorCleared } from '../../journal/reconstruct-prior';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { accrual2AInputOf } from '../../journal/build-accrual-2a-lines';
import { ReceiptsService } from '../../receipts/receipts.service';
import { LateFeeWaiverService as CollectorWaiverService } from '../../late-fee-waiver/late-fee-waiver.service';
import { PaymentApprovalController } from '../payment-approval.controller';
import { LateFeeWaiverService as ApprovalWaiverService } from './late-fee-waiver.service';
import { PaymentReceiptOrchestrator } from './payment-receipt-orchestrator';
import { paymentApprovalSnapshot } from './payment-approval-request.util';
import { voidReceiptWithApproval } from '../../../../e2e/helpers/payment-approval';
import { OverdueLifecycleCronService } from '../../overdue/services/overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../../overdue/consecutive-missed.service';

const prisma = new PrismaClient();
const D = (n: string | number) => new Decimal(n);
const DAY_MS = 86_400_000;

/** Installment #1 of the 17,000 / 12 fixture: billed = ledger total (ROUND_DOWN 1,416.66 + 99.17). */
const INSTALLMENT_TOTAL = '1515.83';
/**
 * The subject installment. Each fixture contract gets exactly one open Payment row
 * (this one, unless a test adds #2), so the row reaching PAID completes the contract —
 * checkContractCompletion counts non-PAID Payment rows.
 */
const SUBJECT_NO = 1;

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
      data: { email: 'admin@bestchoice.com', password: 'hashed_placeholder', name: 'System Admin', role: 'OWNER' },
    });
  }
}

async function ensureOwnerApprover(): Promise<string> {
  const email = 'test-waiver-gl-approver@bestchoice-test.internal';
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) return existing.id;
  return (
    await prisma.user.create({
      data: { email, password: 'hashed_placeholder', name: 'Waiver Approver', role: 'OWNER', isActive: true },
    })
  ).id;
}

async function cleanLedger(): Promise<void> {
  await prisma.paymentApprovalRequest.deleteMany({});
  await prisma.lateFeeWaiverRequest.deleteMany({});
  await prisma.feeWaiverApproval.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.loyaltyPoint.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
}

describe('late-fee waivers settle against the ledger, not Payment.amountPaid', () => {
  let journal: JournalAutoService;
  let orchestrator: PaymentReceiptOrchestrator;
  let receiptsService: ReceiptsService;
  let recordedById: string;
  let approverId: string;
  const audit = { logPaymentEvent: vi.fn(async () => undefined), log: vi.fn(async () => undefined) };
  const products = { transferOwnership: vi.fn(async () => undefined) };
  let approvalWaiver: ApprovalWaiverService;
  let collectorWaiver: CollectorWaiverService;
  let refSeq = 0;

  interface Fixture {
    contractId: string;
    productId: string;
    paymentId: string;
    scheduleId: string;
  }

  /**
   * One 17,000/12 contract whose only Payment row is installment #1 (its last open
   * installment). The installment is accrued (2A) first, as the nightly run does.
   */
  async function seedInstallment(
    opts: { overdueDays?: number; dueInDays?: number; lateFee?: string; accrue?: boolean } = {},
  ) {
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as never).execute(c.id);
    const dueDate =
      opts.dueInDays !== undefined
        ? new Date(Date.now() + opts.dueInDays * DAY_MS)
        : new Date(Date.now() - ((opts.overdueDays ?? 10) * DAY_MS + 1000));
    const payment = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: SUBJECT_NO,
        dueDate,
        amountDue: D(INSTALLMENT_TOTAL),
        lateFee: D(opts.lateFee ?? '0'),
        status: opts.dueInDays !== undefined ? 'PENDING' : 'OVERDUE',
      },
    });
    const sched = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: SUBJECT_NO } },
    });
    if (opts.accrue !== false) {
      await new InstallmentAccrual2ATemplate(journal, prisma as never).execute(sched.id);
    }
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    return { contractId: c.id, productId: contract.productId, paymentId: payment.id, scheduleId: sched.id } as Fixture;
  }

  const pay = (f: Fixture, amount: number, opts: { partial?: boolean; additionalLateFee?: number } = {}) =>
    orchestrator.recordPayment(
      f.contractId,
      SUBJECT_NO,
      amount,
      'CASH',
      recordedById,
      undefined,
      undefined,
      `WGL-${process.pid}-${++refSeq}`,
      '11-1101',
      undefined,
      opts.partial ? 'PARTIAL' : undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      opts.additionalLateFee ?? 0,
    );

  const row = (f: Fixture) => prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } });
  const contractStatus = async (f: Fixture) =>
    (await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } })).status;

  /** Ledger view of the installment: principal still open on 11-2103 and fee booked to 42-1103. */
  async function ledger(f: Fixture) {
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } });
    const { installmentTotal } = computeInstallmentBreakdown(accrual2AInputOf(contract, SUBJECT_NO));
    const { priorPrincipalCleared, priorLateFeeBooked } = await reconstructPriorCleared(
      prisma as never,
      f.scheduleId,
      installmentTotal,
    );
    return {
      principalOpen: installmentTotal.minus(priorPrincipalCleared).toFixed(2),
      feeBooked: priorLateFeeBooked.toFixed(2),
    };
  }

  const entryCount = () => prisma.journalEntry.count();

  /** Service-level WAIVE_LATE_FEE request (see the path-1 note in the header). */
  async function approvalContextFor(paymentId: string) {
    const { contract, snapshot } = await paymentApprovalSnapshot(prisma as never, 'WAIVE_LATE_FEE', paymentId);
    const request = await prisma.paymentApprovalRequest.create({
      data: {
        id: randomUUID(),
        action: 'WAIVE_LATE_FEE',
        targetId: paymentId,
        contractId: contract.id,
        requestedById: recordedById,
        reason: 'ลูกค้าขอผ่อนผัน (ทดสอบ)',
        requiredPermissions: ['WAIVE_LATE_FEE'],
        payload: {},
        snapshot,
        reviewSummary: {},
      },
    });
    return { requestId: request.id, actorId: approverId, reason: 'ตรวจแล้ว' };
  }

  const waiveViaApproval = async (f: Fixture) =>
    approvalWaiver.waiveLateFee(f.paymentId, 'ลูกค้าขอผ่อนผัน (ทดสอบ)', recordedById, approverId, undefined,
      await approvalContextFor(f.paymentId));

  const requestViaCollector = (f: Fixture) =>
    collectorWaiver.create(
      { contractId: f.contractId, paymentIds: [f.paymentId], reason: 'ลูกค้าขอผ่อนผัน (ทดสอบ)' },
      recordedById,
    );

  beforeAll(async () => {
    await cleanLedger();
    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    await ensureSystemAdminUser();
    approverId = await ensureOwnerApprover();

    journal = new JournalAutoService(prisma as never);
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
      { awardLoyaltyPoints: noop, sendPaymentSuccessLine: noop, runMdmAutoUnlock: noop, checkPromiseAfterPayment: noop },
    );
    approvalWaiver = new ApprovalWaiverService(prisma as never, audit as never, products as never);
    collectorWaiver = new CollectorWaiverService(prisma as never, audit as never, products as never);

    await seedStandard17k12m(prisma); // creates the shared salesperson
    recordedById = (
      await prisma.user.findFirstOrThrow({ where: { email: 'test-salesperson@bestchoice-test.internal' } })
    ).id;
  });

  afterAll(async () => {
    await cleanLedger();
    await prisma.$disconnect();
  });

  // ─── (a) fee-first receipt of exactly amountDue ───────────────────────────
  describe('(a) fee-first receipt of exactly amountDue', () => {
    it('the receipt books the fee first: Cr 42-1103 100 + Cr 11-2103 1,415.83, row PARTIALLY_PAID', async () => {
      const f = await seedInstallment({ lateFee: '100' });
      await pay(f, 1515.83, { partial: true });
      expect(await ledger(f)).toEqual({ principalOpen: '100.00', feeBooked: '100.00' });
      const p = await row(f);
      expect([p.status, p.amountPaid.toFixed(2), p.lateFee.toFixed(2)]).toEqual(['PARTIALLY_PAID', '1515.83', '100.00']);
    });

    it('path 1 (payment approval): fee fully collected → refused, row and ledger untouched, contract open', async () => {
      const f = await seedInstallment({ lateFee: '100' });
      await pay(f, 1515.83, { partial: true });
      const before = await entryCount();
      products.transferOwnership.mockClear();

      await expect(waiveViaApproval(f)).rejects.toThrow('ค่าปรับของงวดนี้รับชำระครบแล้ว');

      const p = await row(f);
      expect([p.status, p.lateFeeWaived, p.lateFee.toFixed(2), p.waivedAmount]).toEqual([
        'PARTIALLY_PAID', false, '100.00', null,
      ]);
      expect(await contractStatus(f)).toBe('ACTIVE');
      expect(await ledger(f)).toEqual({ principalOpen: '100.00', feeBooked: '100.00' });
      expect(await entryCount()).toBe(before);
      expect(products.transferOwnership).not.toHaveBeenCalledWith(f.productId, null, expect.anything());
    });

    it('path 2 (collector request): a request raised before the receipt waives nothing once the fee is income', async () => {
      const f = await seedInstallment({ lateFee: '100' });
      const request = await requestViaCollector(f); // unpaid → 100 waivable at request time
      expect(request.totalWaiveAmount.toFixed(2)).toBe('100.00');
      await pay(f, 1515.83, { partial: true });

      const approved = await collectorWaiver.approve(request.id, approverId);

      expect(approved.status).toBe('APPROVED');
      expect(approved.totalWaiveAmount.toFixed(2)).toBe('0.00');
      const p = await row(f);
      expect([p.status, p.lateFeeWaived, p.lateFee.toFixed(2), p.waivedAmount]).toEqual([
        'PARTIALLY_PAID', false, '100.00', null,
      ]);
      expect(await contractStatus(f)).toBe('ACTIVE');
      // ... and a new request is refused outright (nothing waivable).
      await expect(requestViaCollector(f)).rejects.toThrow('ไม่มีค่าปรับค้างให้ยกเว้น');
    });

    /**
     * Same receipt, then a staff-added fee (receipt-path `additionalLateFee` 50)
     * of which the customer paid only 10 — fee-first again. The ledger holds
     * 110 of the 150 fee; principal still owes 100.
     */
    const seedWithRemainingFee = async () => {
      const f = await seedInstallment({ lateFee: '100' });
      await pay(f, 1515.83, { partial: true });
      await pay(f, 10, { partial: true, additionalLateFee: 50 });
      expect(await ledger(f)).toEqual({ principalOpen: '100.00', feeBooked: '110.00' });
      const p = await row(f);
      expect([p.amountPaid.toFixed(2), p.lateFee.toFixed(2)]).toEqual(['1525.83', '150.00']);
      return f;
    };

    for (const path of ['path 1 (payment approval)', 'path 2 (collector request)'] as const) {
      it(`${path}: waives only the uncollected 40, stays PARTIALLY_PAID, contract not completed — then exactly the principal is collectable`, async () => {
        const f = await seedWithRemainingFee();
        const before = await entryCount();

        if (path === 'path 1 (payment approval)') {
          await waiveViaApproval(f);
        } else {
          const request = await requestViaCollector(f);
          expect(request.totalWaiveAmount.toFixed(2)).toBe('40.00');
          const approved = await collectorWaiver.approve(request.id, approverId);
          expect(approved.totalWaiveAmount.toFixed(2)).toBe('40.00');
        }

        let p = await row(f);
        expect([p.status, p.paidDate]).toEqual(['PARTIALLY_PAID', null]);
        expect(p.waivedAmount?.toFixed(2)).toBe('40.00');
        // The charge is reduced to the 110 already collected — still a real charge
        // (amountPaid contains it), so not flagged as a fully waived fee.
        expect([p.lateFee.toFixed(2), p.lateFeeWaived]).toEqual(['110.00', false]);
        expect(p.waivedById).toBe(recordedById);
        expect(p.waivedApprovedById).toBe(approverId);
        expect(await contractStatus(f)).toBe('ACTIVE');
        expect(await entryCount()).toBe(before); // no journal entry from a waiver
        expect(await ledger(f)).toEqual({ principalOpen: '100.00', feeBooked: '110.00' });
        expect(await prisma.feeWaiverApproval.count({ where: { waiverPaymentId: f.paymentId } })).toBe(1);
        expect(audit.logPaymentEvent).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'LATE_FEE_WAIVED', paymentId: f.paymentId, amount: 40 }),
        );

        // Exactly the principal still owed is now collectable — through the cashier
        // receipt (path 1 case) and through bulk allocation, which treats a waived
        // fee as 0 owed (path 2 case).
        if (path === 'path 1 (payment approval)') await pay(f, 100);
        else await orchestrator.autoAllocatePayment(f.contractId, 100, 'CASH', recordedById);
        p = await row(f);
        expect(p.status).toBe('PAID');
        expect(await ledger(f)).toEqual({ principalOpen: '0.00', feeBooked: '110.00' });
        expect(await contractStatus(f)).toBe('COMPLETED');
      });
    }

    /**
     * Voiding every receipt after a partial waiver must not erase the approved waiver.
     * The void reverses both receipts (amountPaid back to 0, the 110 fee income reversed);
     * the nightly late-fee run and the next receipt's recompute must both treat the fee as
     * frozen (isLateFeeFrozen: waivedAmount > 0) — the 110 the waiver left is owed again,
     * the waived 40 stays waived, and no fresh bracket fee (100) replaces it.
     */
    for (const path of ['path 1 (payment approval)', 'path 2 (collector request)'] as const) {
      it(`${path}: voiding every receipt keeps the approved waiver; the 110 is owed again, not a fresh bracket fee`, async () => {
        const f = await seedWithRemainingFee();
        if (path === 'path 1 (payment approval)') await waiveViaApproval(f);
        else await collectorWaiver.approve((await requestViaCollector(f)).id, approverId);

        const receipt = await prisma.receipt.findFirstOrThrow({
          where: { paymentId: f.paymentId, receiptType: 'INSTALLMENT', isVoided: false, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        await voidReceiptWithApproval(prisma, receiptsService, receipt.id,
          'ทดสอบยกเลิกใบเสร็จหลังยกเว้นค่าปรับบางส่วน', recordedById, approverId, 'OWNER');

        let p = await row(f);
        expect([p.amountPaid.toFixed(2), p.status]).toEqual(['0.00', 'OVERDUE']);
        expect([p.lateFee.toFixed(2), p.waivedAmount?.toFixed(2), p.lateFeeWaived]).toEqual(['110.00', '40.00', false]);
        expect(await ledger(f)).toEqual({ principalOpen: '1515.83', feeBooked: '0.00' });

        // Nightly late-fee run (00:00): the stored fee is frozen by the waiver.
        await new OverdueLifecycleCronService(prisma as never, new ConsecutiveMissedService(prisma as never))
          .calculateLateFees();
        p = await row(f);
        expect(p.lateFee.toFixed(2)).toBe('110.00');

        // The next receipt sees the same fee (no receipt-time bracket recompute):
        // amountDue 1,515.83 + 110 closes the installment exactly.
        await pay(f, 1625.83);
        p = await row(f);
        expect([p.status, p.lateFee.toFixed(2), p.waivedAmount?.toFixed(2)]).toEqual(['PAID', '110.00', '40.00']);
        expect(await ledger(f)).toEqual({ principalOpen: '0.00', feeBooked: '110.00' });
        expect(await contractStatus(f)).toBe('COMPLETED');
      });
    }
  });

  // ─── (b) principal truly settled, only the fee outstanding ────────────────
  describe('(b) principal settled by a real receipt, only the fee outstanding', () => {
    /**
     * The current receipt flow cannot leave this state by itself (fee first +
     * the stored fee freezes once anything is paid); it exists on imported /
     * pre-fee-first rows. The principal and its receipt JE come from the real
     * flow (paid on time, no fee — which also completed the contract); the
     * fixture then marks a 100 fee as charged and the row and contract open
     * again, the shape such legacy rows have. amountPaid is never written here.
     */
    const seedPrincipalPaidFeeOpen = async () => {
      const f = await seedInstallment({ dueInDays: 30 });
      await pay(f, 1515.83);
      expect((await row(f)).status).toBe('PAID');
      await prisma.contract.update({ where: { id: f.contractId }, data: { status: 'OVERDUE' } });
      await prisma.payment.update({
        where: { id: f.paymentId },
        data: { status: 'PARTIALLY_PAID', paidDate: null, lateFee: D(100) },
      });
      expect(await ledger(f)).toEqual({ principalOpen: '0.00', feeBooked: '0.00' });
      return f;
    };

    for (const path of ['path 1 (payment approval)', 'path 2 (collector request)'] as const) {
      it(`${path}: waives the whole uncollected fee, settles PAID and completes the last installment's contract`, async () => {
        const f = await seedPrincipalPaidFeeOpen();
        products.transferOwnership.mockClear();

        if (path === 'path 1 (payment approval)') {
          await waiveViaApproval(f);
        } else {
          const approved = await collectorWaiver.approve((await requestViaCollector(f)).id, approverId);
          expect(approved.totalWaiveAmount.toFixed(2)).toBe('100.00');
        }

        const p = await row(f);
        expect(p.status).toBe('PAID');
        expect(p.paidDate).toBeInstanceOf(Date);
        expect([p.lateFee.toFixed(2), p.waivedAmount?.toFixed(2), p.lateFeeWaived]).toEqual(['0.00', '100.00', true]);
        expect(await contractStatus(f)).toBe('COMPLETED');
        // checkContractCompletion releases device ownership inside the same tx.
        expect(products.transferOwnership).toHaveBeenCalledWith(f.productId, null, expect.anything());
        expect(await ledger(f)).toEqual({ principalOpen: '0.00', feeBooked: '0.00' });
      });
    }
  });

  // ─── (c) legacy row without fee journal entries ───────────────────────────
  describe('(c) legacy row with no receipt journal entry', () => {
    /** Imported shape: amountPaid written by the legacy import, no receipt JE at all. */
    const seedLegacy = async (amountPaid: string) => {
      const f = await seedInstallment({ lateFee: '100', accrue: false });
      await prisma.payment.update({
        where: { id: f.paymentId },
        data: {
          amountPaid: D(amountPaid),
          status: 'PARTIALLY_PAID',
          legacyInstallmentCode: `LEGACY-WGL-${randomUUID()}`,
        },
      });
      return f;
    };

    for (const path of ['path 1 (payment approval)', 'path 2 (collector request)'] as const) {
      it(`${path}: feePaid = 0 → amountPaid ≥ amountDue settles as before`, async () => {
        const f = await seedLegacy(INSTALLMENT_TOTAL);
        if (path === 'path 1 (payment approval)') await waiveViaApproval(f);
        else await collectorWaiver.approve((await requestViaCollector(f)).id, approverId);

        const p = await row(f);
        expect([p.status, p.lateFee.toFixed(2), p.waivedAmount?.toFixed(2)]).toEqual(['PAID', '0.00', '100.00']);
        expect(await contractStatus(f)).toBe('COMPLETED');
      });

      it(`${path}: one satang short stays open (no ≤1฿ write-off without a journal entry)`, async () => {
        const f = await seedLegacy('1515.82');
        if (path === 'path 1 (payment approval)') await waiveViaApproval(f);
        else await collectorWaiver.approve((await requestViaCollector(f)).id, approverId);

        const p = await row(f);
        expect([p.status, p.waivedAmount?.toFixed(2)]).toEqual(['PARTIALLY_PAID', '100.00']);
        expect(await contractStatus(f)).toBe('ACTIVE');
      });
    }
  });

  // ─── (d) create() skips PAID rows ─────────────────────────────────────────
  describe('(d) collector create() skips PAID rows', () => {
    it('PAID rows the dialog lists are left out of the request — including one whose fee the ledger never collected', async () => {
      // #1: late receipt of fee + principal → PAID, the row keeps its 100 fee.
      const paid = await seedInstallment({ lateFee: '100' });
      await pay(paid, 1615.83);
      expect((await row(paid)).status).toBe('PAID');
      await prisma.contract.update({ where: { id: paid.contractId }, data: { status: 'OVERDUE' } });
      // #2: PAID with a 100 fee and no fee entry in the ledger (imported row) — only
      // the PAID filter keeps it out; its fee is "waivable" by the ledger rule.
      const paidLegacy = await prisma.payment.create({
        data: {
          contractId: paid.contractId,
          installmentNo: SUBJECT_NO + 1,
          dueDate: new Date(Date.now() - 6 * DAY_MS),
          amountDue: D(INSTALLMENT_TOTAL),
          amountPaid: D(INSTALLMENT_TOTAL),
          lateFee: D(100),
          status: 'PAID',
          paidDate: new Date(),
          legacyInstallmentCode: `LEGACY-WGL-${randomUUID()}`,
        },
      });
      // #3: open and overdue.
      const open = await prisma.payment.create({
        data: {
          contractId: paid.contractId,
          installmentNo: SUBJECT_NO + 2,
          dueDate: new Date(Date.now() - 5 * DAY_MS),
          amountDue: D(INSTALLMENT_TOTAL),
          lateFee: D(100),
          status: 'OVERDUE',
        },
      });
      const ids = [paid.paymentId, paidLegacy.id, open.id];

      const request = await collectorWaiver.create(
        { contractId: paid.contractId, paymentIds: ids, reason: 'ลูกค้าขอผ่อนผัน (ทดสอบ)' },
        recordedById,
      );
      expect(request.paymentIds).toEqual([open.id]);
      expect(request.totalWaiveAmount.toFixed(2)).toBe('100.00');

      const before = await prisma.lateFeeWaiverRequest.count();
      await expect(
        collectorWaiver.create(
          { contractId: paid.contractId, paymentIds: [paid.paymentId, paidLegacy.id], reason: 'ลูกค้าขอผ่อนผัน (ทดสอบ)' },
          recordedById,
        ),
      ).rejects.toThrow('ไม่มีค่าปรับค้างให้ยกเว้น');
      expect(await prisma.lateFeeWaiverRequest.count()).toBe(before);

      // Approving the request never touches the PAID rows.
      await collectorWaiver.approve(request.id, approverId);
      for (const id of [paid.paymentId, paidLegacy.id]) {
        const r = await prisma.payment.findUniqueOrThrow({ where: { id } });
        expect([r.lateFeeWaived, r.lateFee.toFixed(2), r.waivedAmount]).toEqual([false, '100.00', null]);
      }
      const openRow = await prisma.payment.findUniqueOrThrow({ where: { id: open.id } });
      expect([openRow.status, openRow.lateFeeWaived, openRow.waivedAmount?.toFixed(2)]).toEqual([
        'OVERDUE', true, '100.00',
      ]);
    });
  });

  // ─── settlement only where the receipt path could collect ─────────────────
  it('a principal-covered row on a TERMINATED contract: fee waived, row and contract status untouched', async () => {
    const f = await seedInstallment({ lateFee: '100', accrue: false });
    await prisma.payment.update({
      where: { id: f.paymentId },
      data: { amountPaid: D(INSTALLMENT_TOTAL), status: 'PARTIALLY_PAID', legacyInstallmentCode: `LEGACY-WGL-${randomUUID()}` },
    });
    await prisma.contract.update({ where: { id: f.contractId }, data: { status: 'TERMINATED' } });

    await collectorWaiver.approve((await requestViaCollector(f)).id, approverId);

    const p = await row(f);
    expect([p.status, p.lateFeeWaived, p.waivedAmount?.toFixed(2)]).toEqual(['PARTIALLY_PAID', true, '100.00']);
    expect(await contractStatus(f)).toBe('TERMINATED');
  });

  // ─── path 1 through the real approval controller (unpaid row) ─────────────
  it('path 1 via the real approval queue: unpaid overdue row → fee waived, row stays OVERDUE (unchanged behaviour)', async () => {
    const f = await seedInstallment({ lateFee: '100' });
    const controller = new PaymentApprovalController(prisma as never, undefined as never, undefined as never, undefined as never);
    const request = await controller.create(
      { action: 'WAIVE_LATE_FEE', targetId: f.paymentId, reason: 'ลูกค้าขอผ่อนผัน (ทดสอบ)', payload: {} },
      recordedById,
    );
    const out = await approvalWaiver.waiveLateFee(f.paymentId, 'ลูกค้าขอผ่อนผัน (ทดสอบ)', recordedById, approverId, undefined,
      { requestId: request.id, actorId: approverId, reason: 'ตรวจแล้ว' });

    expect(out.originalLateFee).toBe(100);
    const p = await row(f);
    expect([p.status, p.lateFee.toFixed(2), p.waivedAmount?.toFixed(2), p.lateFeeWaived]).toEqual([
      'OVERDUE', '0.00', '100.00', true,
    ]);
    expect((await prisma.paymentApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('APPROVED');
    expect(await contractStatus(f)).toBe('ACTIVE');
  });
});
