/**
 * payments.service.late-fee.spec.ts
 *
 * Characterization (golden) test for the REAL-TIME late-fee computation in
 * PaymentsService.recordPayment (payments.service.ts lines ~269-285).
 *
 * The late fee is recomputed at payment time using the FLAT-BRACKET model
 * (D2, owner decision 2026-06-25):
 *
 *   daysOverdue   = floor((now - dueDate) / 1 day)
 *   bracketFee    = 0 if daysOverdue <= 0
 *                 = tier1Amount (default 50฿)  if 1 <= daysOverdue < tier2MinDays (default 3)
 *                 = tier2Amount (default 100฿) if daysOverdue >= tier2MinDays
 *
 * The bracket fee is SET unconditionally (retroactive downgrade included),
 * unless lateFeeWaived=true. The old per-day/5%-cap model is gone.
 *
 * These tests drive recordPayment end-to-end against a mocked Prisma (same unit
 * pattern as payments.service.advance.spec.ts) and lock the exact Decimal late
 * fee captured from BOTH the Payment.update write AND the lateFee forwarded to
 * PaymentReceiptTemplate.execute.
 *
 * Money is Prisma.Decimal — asserted via .toFixed(2).
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

import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
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
const DAY_MS = 1000 * 60 * 60 * 24;

/** A dueDate exactly `days` days in the past (+1s buffer so floor() lands on `days`). */
const overdueDays = (days: number) => new Date(Date.now() - (days * DAY_MS + 1000));

describe('PaymentsService — real-time late fee on payment', () => {
  let service: PaymentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // PR-843/I2 Phase 3 3a — recordPayment now posts via the PaymentReceiptTemplate
  // primitive, so the forwarded-lateFee assertions target THIS mock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let receiptPrimitiveExecute: any;

  // Per-test config for the bracket SystemConfig keys (null = use defaults).
  let lateFeeT1Cfg: string | null;
  let lateFeeT2Cfg: string | null;
  let lateFeeT2MinDaysCfg: string | null;

  const makeContract = () => ({
    id: 'lf-contract-1',
    contractNumber: 'BC-LF-001',
    status: 'OVERDUE',
    deletedAt: null,
    branchId: 'branch-1',
    customerId: 'cust-1',
    advanceBalance: D(0),
  });

  const makePayment = (overrides: Record<string, unknown> = {}) => ({
    id: 'lf-payment-1',
    contractId: 'lf-contract-1',
    installmentNo: 1,
    amountDue: D(10000),
    amountPaid: D(0),
    lateFee: D(0),
    lateFeeWaived: false,
    dueDate: overdueDays(3),
    status: 'OVERDUE',
    evidenceUrl: null,
    notes: null,
    depositAccountCode: null,
    ...overrides,
  });

  beforeEach(async () => {
    lateFeeT1Cfg = null;
    lateFeeT2Cfg = null;
    lateFeeT2MinDaysCfg = null;

    const buildMockPrisma = () => ({
      contract: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(makeContract())),
        update: jest.fn().mockResolvedValue(makeContract()),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(makePayment()),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({
              id: 'lf-payment-1',
              contractId: 'lf-contract-1',
              installmentNo: 1,
              amountDue: D(10000),
              amountPaid: data.amountPaid ?? D(0),
              lateFee: data.lateFee ?? D(0),
              status: data.status ?? 'OVERDUE',
              paidDate: data.paidDate ?? null,
              depositAccountCode: data.depositAccountCode ?? null,
            }),
          ),
        count: jest.fn().mockResolvedValue(1), // checkContractCompletion: not all paid
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: 0, lateFee: 0 } }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', defaultCashAccountCode: null, deletedAt: null }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }),
      },
      systemConfig: {
        // Key-aware dispatch: period-lock keys return null (open period);
        // bracket late-fee keys return the per-test config.
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { key: string } }) => {
            if (where.key === 'late_fee_tier1_amount') {
              return Promise.resolve(lateFeeT1Cfg ? { value: lateFeeT1Cfg } : null);
            }
            if (where.key === 'late_fee_tier2_amount') {
              return Promise.resolve(lateFeeT2Cfg ? { value: lateFeeT2Cfg } : null);
            }
            if (where.key === 'late_fee_tier2_min_days') {
              return Promise.resolve(lateFeeT2MinDaysCfg ? { value: lateFeeT2MinDaysCfg } : null);
            }
            return Promise.resolve(null);
          }),
      },
      installmentSchedule: {
        // Lazy-gen recovery (#1170): count>0 → ensureInstallmentSchedules no-op.
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        // Return a schedule so PaymentReceiptTemplate.execute is invoked and
        // we can capture the forwarded lateFee.
        findUnique: jest.fn().mockResolvedValue({ id: 'lf-sched-1' }),
      },
      callLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      partialPaymentLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'al-1' }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrismaInst)),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockPrismaInst: any = buildMockPrisma();
    prisma = mockPrismaInst;

    receiptPrimitiveExecute = jest
      .fn()
      .mockResolvedValue({ entryNo: 'JE-LF', split: { principalRemainingAfter: D(0) } });

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
        { provide: JournalAutoService, useValue: { createAndPost: jest.fn().mockResolvedValue({ id: 'je-1' }) } },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn() } },
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
        { provide: PaymentReceiptTemplate, useValue: { execute: receiptPrimitiveExecute } },
        { provide: Vat60dayReversalTemplate, useValue: { execute: jest.fn().mockResolvedValue(null) } },
        { provide: BadDebtService, useValue: { reverseStageOnPayment: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  /** Pull the lateFee written by tx.payment.update (the late-fee-only write), if any. */
  const lateFeeWritten = (): Prisma.Decimal | undefined => {
    const call = prisma.payment.update.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0]?.data && 'lateFee' in c[0].data && !('amountPaid' in c[0].data),
    );
    return call ? (call[0].data.lateFee as Prisma.Decimal) : undefined;
  };

  /** Pull the lateFee forwarded to PaymentReceiptTemplate.execute, if any. */
  const lateFeeForwarded = (): Prisma.Decimal | undefined => {
    const arg = receiptPrimitiveExecute.mock.calls[0]?.[0];
    return arg?.lateFee;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // On-time → zero late fee
  // ───────────────────────────────────────────────────────────────────────────
  it('on-time payment (future due date) computes NO late fee', async () => {
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ dueDate: new Date(Date.now() + 7 * DAY_MS) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      10000, // exactly amountDue, no late fee
      'CASH',
      'user-1',
      'https://slip.test/ontime',
      undefined,
      'LF-ONTIME',
      '11-1101',
    );

    // No lateFee-only Payment.update write happened.
    expect(lateFeeWritten()).toBeUndefined();
    // Template receives lateFee = undefined (lateFee.gt(0) is false).
    expect(lateFeeForwarded()).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Tier 1: 1-2 days overdue → flat 50฿ (default tier1Amount)
  // ───────────────────────────────────────────────────────────────────────────
  it('1 day overdue → tier1 flat fee = 50.00', async () => {
    // 1 day overdue: 1 < tier2MinDays(3) → tier1Amount(50).
    prisma.payment.findFirst.mockResolvedValue(makePayment({ dueDate: overdueDays(1) }));

    await service.recordPayment(
      'lf-contract-1',
      1,
      10050, // amountDue(10000) + lateFee(50)
      'CASH',
      'user-1',
      'https://slip.test/1d',
      undefined,
      'LF-1DAY',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('50.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('50.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Tier 2: >= 3 days overdue → flat 100฿ (default tier2Amount)
  // ───────────────────────────────────────────────────────────────────────────
  it('3 days overdue → tier2 flat fee = 100.00 (bracket threshold)', async () => {
    // 3 days overdue: 3 >= tier2MinDays(3) → tier2Amount(100).
    prisma.payment.findFirst.mockResolvedValue(makePayment({ dueDate: overdueDays(3) }));

    await service.recordPayment(
      'lf-contract-1',
      1,
      10100, // amountDue(10000) + lateFee(100)
      'CASH',
      'user-1',
      'https://slip.test/3d',
      undefined,
      'LF-3DAY',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('100.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('100.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Tier 2: many days overdue — still flat 100 (NOT per-day, no cap logic)
  // ───────────────────────────────────────────────────────────────────────────
  it('10 days overdue → still tier2 flat fee = 100.00 (flat bracket, not per-day)', async () => {
    // 10 days overdue: 10 >= tier2MinDays(3) → tier2Amount(100).
    // No per-day scaling, no 5% pctCap, no absolute cap.
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ amountDue: D(1000), dueDate: overdueDays(10) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      1100, // amountDue(1000) + lateFee(100)
      'CASH',
      'user-1',
      'https://slip.test/10d',
      undefined,
      'LF-10DAY',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('100.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('100.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Config-driven tier amounts (SystemConfig overrides)
  // ───────────────────────────────────────────────────────────────────────────
  it('SystemConfig overrides: tier2=200 for >=3 days', async () => {
    lateFeeT2Cfg = '200';
    lateFeeT2MinDaysCfg = '3';
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ amountDue: D(100000), dueDate: overdueDays(40) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      100200, // amountDue(100000) + lateFee(200)
      'CASH',
      'user-1',
      'https://slip.test/cfg',
      undefined,
      'LF-CFG',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('200.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('200.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Waiver flag suppresses real-time recompute entirely
  // ───────────────────────────────────────────────────────────────────────────
  it('lateFeeWaived=true skips recompute → no late fee charged even when overdue', async () => {
    // 30 days overdue but waived → the `if (!payment.lateFeeWaived ...)` guard
    // is skipped, so lateFee stays at the stored value (0).
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ dueDate: overdueDays(30), lateFeeWaived: true }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      10000, // amountDue only — no late fee added
      'CASH',
      'user-1',
      'https://slip.test/waived',
      undefined,
      'LF-WAIVED',
      '11-1101',
    );

    expect(lateFeeWritten()).toBeUndefined();
    expect(lateFeeForwarded()).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // No change when stored fee already equals the bracket
  // ───────────────────────────────────────────────────────────────────────────
  it('no Payment.update write when stored lateFee already equals the bracket', async () => {
    // Stored lateFee = 100 (tier2 for 3 days). bracketFee = 100. Equal → no write.
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ dueDate: overdueDays(3), lateFee: D(100) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      10100, // amountDue(10000) + stored lateFee(100)
      'CASH',
      'user-1',
      'https://slip.test/equal',
      undefined,
      'LF-EQUAL',
      '11-1101',
    );

    // No lateFee-only write (computed 100 equals stored 100 — bracketFee.eq(lateFee)).
    expect(lateFeeWritten()).toBeUndefined();
    // The stored 100 IS still forwarded to the template (lateFee.gt(0)).
    expect(lateFeeForwarded()?.toFixed(2)).toBe('100.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Retroactive downgrade: bracket SETS the fee (even downward)
  // ───────────────────────────────────────────────────────────────────────────
  it('retroactive downgrade: a stored 200฿ fee recomputes DOWN to the 100฿ bracket', async () => {
    // Arrange: an installment 10 days overdue with an inflated stored lateFee=200
    // (legacy linear model). Bracket for >=3 days = 100.
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ dueDate: overdueDays(10), lateFee: D(200), amountDue: D(1515.83) }),
    );

    // Act: record a payment. Amount = amountDue(1515.83) + bracket(100) = 1615.83.
    await service.recordPayment(
      'lf-contract-1',
      1,
      1615.83,
      'CASH',
      'user-1',
      'https://slip.test/retro',
      undefined,
      'LF-RETRO',
      '11-1101',
    );

    // Assert: stored lateFee was SET to the bracket (100), NOT left at 200.
    expect(lateFeeWritten()?.toFixed(2)).toBe('100.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('100.00');
  });
});
