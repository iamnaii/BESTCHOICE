/**
 * payments.credit-waive-summary.spec.ts
 *
 * Wave 3 MED gap-fill — CHARACTERIZATION (golden) tests that PIN the CURRENT
 * shipped behaviour of four money-bearing PaymentsService methods. No source is
 * modified; quirks are encoded as goldens and reported.
 *
 * Coverage (real money logic only — existing specs cover record/advance/late-fee/
 * preview-journal-money and are intentionally NOT duplicated here):
 *   - applyCreditBalance (payments.service.ts ~1052-1177): credit allocation
 *     across installments, per-installment credit-allocation JE (Dr 21-5101 /
 *     Cr 11-2103 = the THIS-allocation DELTA, not cumulative), creditUsed /
 *     creditRemaining, and the "no credit" guard.
 *   - waiveLateFee (~1327-1462): waive → lateFee 0 + waivedAmount captured +
 *     PARTIALLY_PAID→PAID transition + paidDate set + checkContractCompletion +
 *     the >5000 THB unusual-waiver Sentry branch.
 *   - getDailySummary (~899-971): aggregate sums kept at 2-dp (W6 fix — no
 *     satang drop), byMethod built from the current page.
 *   - previewJournal PARTIAL case (~1882-1912): Dr deposit / Cr 11-2103, balanced.
 *
 * Pattern: hand-mocked PrismaService + stubbed deps (mirrors the credit-check
 * + payments.service.late-fee specs). Money is Prisma.Decimal in prod — passed
 * as real Prisma.Decimal where the code does Decimal ops, plain numbers where it
 * does Number(x). $transaction(cb) → cb(txMock); period-lock SystemConfig keys
 * resolve to null (open period).
 */

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  SentryModule: class {},
}));

import * as Sentry from '@sentry/node';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { AuditService } from '../audit/audit.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { PromiseService } from '../overdue/promise.service';
import { MdmLockService } from '../overdue/mdm-lock.service';
import { PaymentReceiptTemplate } from '../journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { BadDebtService } from '../accounting/bad-debt.service';

const D = (n: number | string) => new Prisma.Decimal(n);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

describe('PaymentsService — credit / waive / daily-summary / partial-preview (Wave 3 MED gap-fill)', () => {
  let service: PaymentsService;
  let prisma: AnyObj;
  let createAndPost: jest.Mock;
  let receiptExecute: jest.Mock;
  let vat60Execute: jest.Mock;

  /** Build the mock Prisma. tx === root instance so $transaction(cb) reuses it. */
  const buildPrisma = () => {
    const inst: AnyObj = {
      contract: {
        findUnique: jest.fn(),
        // Used by ensureInstallmentSchedules (#1170) only when the schedule is missing.
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'cr-contract-1',
          totalMonths: 12,
          financedAmount: D(10000),
          interestTotal: D(1190),
          monthlyPayment: D('1515.83'),
          paymentDueDay: 5,
          createdAt: new Date(2026, 0, 10),
        }),
        update: jest.fn().mockResolvedValue({ id: 'co-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      payment: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest
          .fn()
          // Echo the write back, merged onto a base row, so callers see the
          // post-update shape (status / paidDate / amountPaid / lateFee).
          // installmentNo is derived from the `cr-pay-N` id when present (so the
          // applyCreditBalance path resolves the right per-installment schedule),
          // else defaults to 1 (waiveLateFee tests use single-installment rows).
          .mockImplementation(({ where, data }: { where: AnyObj; data: AnyObj }) => {
            const m = /^cr-pay-(\d+)$/.exec(where.id ?? '');
            const installmentNo = m ? Number(m[1]) : 1;
            return Promise.resolve({ id: where.id, installmentNo, ...data });
          }),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: 0, lateFee: 0 } }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'approver-1',
          role: 'OWNER',
          isActive: true,
          deletedAt: null,
          defaultCashAccountCode: null,
        }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }),
      },
      systemConfig: {
        // period-lock keys → null (treated as open period)
        findUnique: jest.fn().mockResolvedValue(null),
      },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '11-1101', name: 'เงินสด' },
          { code: '11-2103', name: 'ลูกหนี้ค้างชำระ' },
        ]),
      },
      installmentSchedule: {
        // Lazy-gen recovery (#1170): count>0 → ensureInstallmentSchedules no-op.
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'al-1' }),
      },
      feeWaiverApproval: {
        create: jest.fn().mockResolvedValue({ id: 'fwa-1' }),
      },
      callLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // $transaction(cb) → cb(inst). Ignores the optional 2nd opts arg
      // (isolationLevel) the way Prisma does at runtime for a callback tx.
      $transaction: jest.fn((cb: (tx: AnyObj) => Promise<AnyObj>) => cb(inst)),
    };
    return inst;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();
    createAndPost = jest.fn().mockResolvedValue({ id: 'je-1' });
    receiptExecute = jest.fn().mockResolvedValue({ entryNo: 'JE', split: { principalRemainingAfter: 0 } });
    vat60Execute = jest.fn().mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReceiptsService, useValue: { generateReceipt: jest.fn().mockResolvedValue({ id: 'r-1' }) } },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
            logPaymentEvent: jest.fn().mockResolvedValue(undefined),
            logReceiptEvent: jest.fn().mockResolvedValue(undefined),
            logContractFinancialEvent: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: JournalAutoService, useValue: { createAndPost } },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: LineOaService,
          useValue: { buildPaymentSuccess: jest.fn().mockReturnValue({}), sendFlexMessage: jest.fn() },
        },
        {
          provide: FlexTemplatesService,
          useValue: { paymentReceipt: jest.fn().mockReturnValue({ type: 'flex', altText: 't', contents: {} }) },
        },
        { provide: QuickReplyService, useValue: { afterPayment: jest.fn().mockReturnValue([]) } },
        { provide: PromiseService, useValue: { findActivePromise: jest.fn().mockResolvedValue(null) } },
        { provide: MdmLockService, useValue: { autoUnlock: jest.fn().mockResolvedValue(undefined) } },
        { provide: PaymentReceiptTemplate, useValue: { execute: receiptExecute } },
        { provide: Vat60dayReversalTemplate, useValue: { execute: vat60Execute } },
        { provide: BadDebtService, useValue: { reverseStageOnPayment: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // applyCreditBalance — credit 4000 over two 3000 installments
  // ───────────────────────────────────────────────────────────────────────────
  describe('applyCreditBalance', () => {
    const mkContract = (creditBalance: Prisma.Decimal, payments: AnyObj[]) => ({
      id: 'cr-contract-1',
      contractNumber: 'BC-CR-001',
      deletedAt: null,
      creditBalance,
      payments,
    });

    const mkInstallment = (no: number) => ({
      id: `cr-pay-${no}`,
      installmentNo: no,
      amountDue: D(3000),
      lateFee: D(0),
      amountPaid: D(0),
      status: 'PENDING',
      notes: null,
    });

    it('credit=4000 over two 3000 installments → p1 PAID (primitive delta=3000 isFinal), p2 PARTIALLY_PAID (primitive delta=1000 NOT final — partials now ledgered), creditUsed=4000 creditRemaining=0', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        mkContract(D(4000), [mkInstallment(1), mkInstallment(2)]),
      );
      // PR-843/I2 Phase 3 3d — applyCreditBalance now resolves the
      // InstallmentSchedule per installment so it can call the primitive.
      prisma.installmentSchedule.findUnique.mockImplementation(
        ({ where }: { where: AnyObj }) => {
          const no = where.contractId_installmentNo.installmentNo;
          return Promise.resolve({ id: `cr-sched-${no}`, vat60dayJournalEntryId: null });
        },
      );

      const result = await service.applyCreditBalance('cr-contract-1', 'user-1');

      // Two installments touched.
      expect(prisma.payment.update).toHaveBeenCalledTimes(2);
      expect(result.allocatedPayments).toHaveLength(2);

      // p1 — cleared in full
      const p1Write = prisma.payment.update.mock.calls[0][0];
      expect(p1Write.where.id).toBe('cr-pay-1');
      expect(p1Write.data.status).toBe('PAID');
      expect((p1Write.data.amountPaid as Prisma.Decimal).toFixed(2)).toBe('3000.00');
      expect(p1Write.data.paidDate).toBeInstanceOf(Date);
      expect(p1Write.data.paymentMethod).toBe('CREDIT_BALANCE');

      // p2 — partial 1000, no paidDate, PARTIALLY_PAID
      const p2Write = prisma.payment.update.mock.calls[1][0];
      expect(p2Write.where.id).toBe('cr-pay-2');
      expect(p2Write.data.status).toBe('PARTIALLY_PAID');
      expect((p2Write.data.amountPaid as Prisma.Decimal).toFixed(2)).toBe('1000.00');
      expect(p2Write.data.paidDate).toBeNull();

      // PR-843/I2 Phase 3 3d — the credit-application JE is now posted via the
      // PaymentReceiptTemplate primitive (delta-clear via Dr 21-5101), NOT the
      // custom createAndPost inline JE, and is posted on BOTH the full (p1) and
      // the partial (p2) allocation (partials are now ledgered, defect 2).
      expect(createAndPost).not.toHaveBeenCalled();
      expect(receiptExecute).toHaveBeenCalledTimes(2);

      // p1 — completing receipt: delta=3000 (the THIS-allocation DELTA, not
      // cumulative), debitAccountCode 21-5101 (customer credit, NOT cash),
      // isFinalReceipt=true.
      const p1Call = receiptExecute.mock.calls[0][0];
      expect(p1Call.installmentScheduleId).toBe('cr-sched-1');
      expect((p1Call.delta as Prisma.Decimal).toFixed(2)).toBe('3000.00');
      expect(p1Call.debitAccountCode).toBe('21-5101');
      expect(p1Call.isFinalReceipt).toBe(true);
      expect(p1Call.paymentId).toBe('cr-pay-1');
      // No lateFee on these installments → undefined (no Cr 42-1103 leg).
      expect(p1Call.lateFee).toBeUndefined();
      // PR-843/I2 Phase 5b — applyCreditBalance always clears the FULL owed amount
      // per installment, so a ≤1฿ last-installment residual is a system rounding
      // artifact → the flag is true on every primitive call (no approver on this path).
      expect(p1Call.autoApproveSystemRounding).toBe(true);

      // p2 — partial receipt: delta=1000, 21-5101, isFinalReceipt=false (stays open).
      const p2Call = receiptExecute.mock.calls[1][0];
      expect(p2Call.installmentScheduleId).toBe('cr-sched-2');
      expect((p2Call.delta as Prisma.Decimal).toFixed(2)).toBe('1000.00');
      expect(p2Call.debitAccountCode).toBe('21-5101');
      expect(p2Call.isFinalReceipt).toBe(false);
      expect(p2Call.paymentId).toBe('cr-pay-2');
      expect(p2Call.autoApproveSystemRounding).toBe(true);

      // No 60-day mandatory VAT JE on these installments → no reversal.
      expect(vat60Execute).not.toHaveBeenCalled();

      // Credit totals
      expect(result.creditUsed).toBe(4000);
      expect(result.creditRemaining).toBe(0);

      // contract.creditBalance updated to the remaining Decimal (0).
      const contractUpdate = prisma.contract.update.mock.calls.find(
        (c: AnyObj) => c[0]?.data?.creditBalance !== undefined,
      );
      expect((contractUpdate[0].data.creditBalance as Prisma.Decimal).toFixed(2)).toBe('0.00');

      // Per-installment CREDIT_APPLIED audit (one per touched installment).
      const creditApplied = prisma.auditLog.create.mock.calls.filter(
        (c: AnyObj) => c[0]?.data?.action === 'CREDIT_APPLIED',
      );
      expect(creditApplied).toHaveLength(2);
    });

    it('PAID-no-JE (credit): alarms via Sentry + keeps the credit application (no throw) when the schedule is unpostable', async () => {
      // #1170 — the credit path now mirrors recordPayment/handlePaymentCallback:
      // lazy-gen the schedule before the receipt JE, and on a genuine anomaly
      // (ungeneratable + still no row) alarm loudly instead of silently skipping.
      (Sentry.captureException as jest.Mock).mockClear();
      prisma.contract.findUnique.mockResolvedValue(mkContract(D(3000), [mkInstallment(1)]));
      // Data anomaly: no rows AND ungeneratable (totalMonths=0); lookup stays null.
      prisma.installmentSchedule.count.mockResolvedValueOnce(0);
      prisma.contract.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'cr-contract-1',
        totalMonths: 0,
        financedAmount: D(0),
        interestTotal: null,
        monthlyPayment: null,
        paymentDueDay: null,
        createdAt: new Date(2026, 0, 10),
      });
      prisma.installmentSchedule.findUnique.mockResolvedValue(null);

      // Does not throw — the customer's credit application is real and is applied.
      await service.applyCreditBalance('cr-contract-1', 'user-1');

      expect(prisma.installmentSchedule.createMany).not.toHaveBeenCalled();
      expect(receiptExecute).not.toHaveBeenCalled();
      expect(Sentry.captureException as jest.Mock).toHaveBeenCalled();
      // The credit is still applied (Payment.update written) — no rollback.
      expect(prisma.payment.update).toHaveBeenCalled();
    });

    it('credit=0 → throws BadRequestException "ไม่มียอดเครดิตในสัญญานี้"', async () => {
      prisma.contract.findUnique.mockResolvedValue(mkContract(D(0), [mkInstallment(1)]));

      await expect(service.applyCreditBalance('cr-contract-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.applyCreditBalance('cr-contract-1', 'user-1')).rejects.toThrow(
        'ไม่มียอดเครดิตในสัญญานี้',
      );
      // No allocation work happened.
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(createAndPost).not.toHaveBeenCalled();
      expect(receiptExecute).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // waiveLateFee — PARTIALLY_PAID → PAID, lateFee zeroed, waivedAmount captured
  // ───────────────────────────────────────────────────────────────────────────
  describe('waiveLateFee', () => {
    const mkPayment = (overrides: Record<string, unknown> = {}) => ({
      id: 'wv-pay-1',
      contractId: 'wv-contract-1',
      installmentNo: 1,
      amountDue: D(3000),
      amountPaid: D(3000),
      lateFee: D(200),
      lateFeeWaived: false,
      status: 'PARTIALLY_PAID',
      deletedAt: null,
      notes: null,
      ...overrides,
    });

    it('lateFee=200 on PARTIALLY_PAID (amountPaid==amountDue) → lateFee 0, waivedAmount 200, status PAID, paidDate set, completion checked', async () => {
      prisma.payment.findUnique.mockResolvedValue(mkPayment());
      // checkContractCompletion: all installments now paid → completes contract.
      prisma.payment.count.mockResolvedValue(0);

      const result = await service.waiveLateFee('wv-pay-1', 'goodwill', 'requester-1', 'approver-1');

      const write = prisma.payment.update.mock.calls[0][0];
      expect(write.data.lateFee).toBe(0);
      expect(write.data.lateFeeWaived).toBe(true);
      expect(write.data.waivedAmount).toBe(200);
      expect(write.data.waivedById).toBe('requester-1');
      expect(write.data.waivedApprovedById).toBe('approver-1');
      expect(write.data.waivedReason).toBe('goodwill');
      // PARTIALLY_PAID + amountPaid(3000) >= amountDue(3000) → flips to PAID + paidDate.
      expect(write.data.status).toBe('PAID');
      expect(write.data.paidDate).toBeInstanceOf(Date);

      // FeeWaiverApproval immutable evidence row written.
      expect(prisma.feeWaiverApproval.create).toHaveBeenCalledTimes(1);

      // checkContractCompletion ran inside the tx (payment.count probed).
      expect(prisma.payment.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contractId: 'wv-contract-1', deletedAt: null }),
        }),
      );

      // Return shape carries the captured original fee.
      expect(result.originalLateFee).toBe(200);
      // 200 ≤ 5000 → no unusual-waiver Sentry alarm.
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('requester === approver → ForbiddenException (Segregation of Duties), no write', async () => {
      await expect(
        service.waiveLateFee('wv-pay-1', 'self approve', 'same-user', 'same-user'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('lateFee already 0 → BadRequestException "รายการนี้ไม่มีค่าปรับ"', async () => {
      prisma.payment.findUnique.mockResolvedValue(mkPayment({ lateFee: D(0) }));

      await expect(
        service.waiveLateFee('wv-pay-1', 'no fee', 'requester-1', 'approver-1'),
      ).rejects.toThrow('รายการนี้ไม่มีค่าปรับ');
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('lateFee > 5000 → fires the "Large late-fee waiver" Sentry warning (4-eyes guard observability)', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        mkPayment({ lateFee: D(6000), amountPaid: D(0), status: 'OVERDUE' }),
      );
      // Not fully paid (amountPaid 0 < amountDue 3000) → status stays, no completion.
      prisma.payment.count.mockResolvedValue(1);

      const result = await service.waiveLateFee('wv-pay-1', 'big waiver', 'requester-1', 'approver-1');

      expect(result.originalLateFee).toBe(6000);
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Large late-fee waiver',
        expect.objectContaining({
          level: 'warning',
          extra: expect.objectContaining({ amount: 6000, paymentId: 'wv-pay-1' }),
        }),
      );
      // amountPaid 0 < amountDue 3000 → NOT fully paid → status untouched (no PAID flip).
      const write = prisma.payment.update.mock.calls[0][0];
      expect(write.data.status).toBeUndefined();
      expect(write.data.paidDate).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // getDailySummary — aggregate sums kept at 2-dp (W6 fix), byMethod from page
  // ───────────────────────────────────────────────────────────────────────────
  describe('getDailySummary', () => {
    it('aggregate _sum amountPaid=251.67 lateFee=12.34 → totalAmount=251.67 (no satang drop), totalLateFees=12.34; two CASH 152.50+99.17 → 251.67', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { paymentMethod: 'CASH', amountPaid: D(152.5) },
        { paymentMethod: 'CASH', amountPaid: D(99.17) },
      ]);
      prisma.payment.count.mockResolvedValue(2);
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountPaid: D(251.67), lateFee: D(12.34) },
      });

      const summary = await service.getDailySummary('2026-06-08');

      // W6 fix: 2-dp precision preserved — NOT Math.round'd to 252.
      expect(summary.totalAmount).toBe(251.67);
      expect(summary.totalLateFees).toBe(12.34);
      expect(summary.totalPayments).toBe(2);
      // byMethod accumulated from the page (152.50 + 99.17 = 251.67).
      expect(summary.byMethod).toEqual({ CASH: 251.67 });
    });

    it('empty day → aggregate _sum nulls coalesce to 0; byMethod {}', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: null, lateFee: null } });

      const summary = await service.getDailySummary('2026-06-08');

      expect(summary.totalAmount).toBe(0);
      expect(summary.totalLateFees).toBe(0);
      expect(summary.byMethod).toEqual({});
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // previewJournal — PARTIAL case line values
  // ───────────────────────────────────────────────────────────────────────────
  describe('previewJournal — PARTIAL case', () => {
    const mkContractRow = () => ({
      id: 'pv-contract-1',
      totalMonths: 12,
      interestTotal: D(0),
      monthlyPayment: D(1515.83),
      vatAmount: null,
    });

    it('accrued installment, case=PARTIAL, amountReceived=1000 → Dr deposit 1000 / Cr 11-2103 1000, balanced', async () => {
      prisma.installmentSchedule.findUnique.mockResolvedValue({
        id: 'pv-sched-1',
        contractId: 'pv-contract-1',
        installmentNo: 3,
        // 2A already accrued → PARTIAL is allowed (no BadRequest guard).
        accrualJournalEntryId: 'je-2a-1',
        dueDate: new Date('2026-06-01'),
        contract: mkContractRow(),
      });

      const preview = await service.previewJournal({
        contractId: 'pv-contract-1',
        installmentNo: 3,
        amountReceived: 1000,
        depositAccountCode: '11-1101',
        case: 'PARTIAL',
      });

      expect(preview.lines).toHaveLength(2);
      const dr = preview.lines.find((l) => l.accountCode === '11-1101');
      const cr = preview.lines.find((l) => l.accountCode === '11-2103');
      expect(dr?.debit).toBe('1000.00');
      expect(dr?.credit).toBe('0.00');
      expect(cr?.credit).toBe('1000.00');
      expect(cr?.debit).toBe('0.00');
      // CoA names resolved from the chartOfAccount mock.
      expect(dr?.accountName).toBe('เงินสด');
      expect(cr?.accountName).toBe('ลูกหนี้ค้างชำระ');

      expect(preview.totalDebit).toBe('1000.00');
      expect(preview.totalCredit).toBe('1000.00');
      expect(preview.isBalanced).toBe(true);
    });

    it('PARTIAL before 2A accrual (no accrualJournalEntryId) → BadRequestException', async () => {
      prisma.installmentSchedule.findUnique.mockResolvedValue({
        id: 'pv-sched-2',
        contractId: 'pv-contract-1',
        installmentNo: 4,
        accrualJournalEntryId: null,
        dueDate: new Date('2026-06-01'),
        contract: mkContractRow(),
      });

      await expect(
        service.previewJournal({
          contractId: 'pv-contract-1',
          installmentNo: 4,
          amountReceived: 1000,
          depositAccountCode: '11-1101',
          case: 'PARTIAL',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('installment not found → NotFoundException "ไม่พบงวดชำระ"', async () => {
      prisma.installmentSchedule.findUnique.mockResolvedValue(null);

      await expect(
        service.previewJournal({
          contractId: 'pv-contract-1',
          installmentNo: 99,
          amountReceived: 1000,
          depositAccountCode: '11-1101',
          case: 'PARTIAL',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
