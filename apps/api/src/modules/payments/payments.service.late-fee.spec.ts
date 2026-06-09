/**
 * payments.service.late-fee.spec.ts
 *
 * Characterization (golden) test for the REAL-TIME late-fee computation in
 * PaymentsService.recordPayment (payments.service.ts lines ~269-285).
 *
 * The late fee is recomputed at payment time (the daily cron may not have run
 * yet). The formula is:
 *
 *   daysOverdue   = floor((now - dueDate) / 1 day)            // only if > 0
 *   feePerDay     = SystemConfig 'late_fee_per_day' ?? 50
 *   cap           = SystemConfig 'late_fee_cap'     ?? 1500   // absolute baht cap
 *   pctCap        = amountDue * BUSINESS_RULES.LATE_FEE_CAP_PCT  // 5% of installment
 *   calculatedFee = round2( min(feePerDay * daysOverdue, cap, pctCap) )
 *
 * The new fee is only written (and forwarded to the 2B receipt template) when
 * calculatedFee > the stored payment.lateFee.
 *
 * These tests drive recordPayment end-to-end against a mocked Prisma (same unit
 * pattern as payments.service.advance.spec.ts) and lock the exact Decimal late
 * fee captured from BOTH the Payment.update write AND the lateFee forwarded to
 * PaymentReceipt2BTemplate.execute.
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

  // Per-test config for the two SystemConfig late-fee keys (null = use defaults).
  let lateFeePerDayCfg: string | null;
  let lateFeeCapCfg: string | null;

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
    lateFeePerDayCfg = null;
    lateFeeCapCfg = null;

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
        // late-fee keys return the per-test config.
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { key: string } }) => {
            if (where.key === 'late_fee_per_day') {
              return Promise.resolve(lateFeePerDayCfg ? { value: lateFeePerDayCfg } : null);
            }
            if (where.key === 'late_fee_cap') {
              return Promise.resolve(lateFeeCapCfg ? { value: lateFeeCapCfg } : null);
            }
            return Promise.resolve(null);
          }),
      },
      installmentSchedule: {
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

  /** Pull the lateFee written by tx.payment.update (the line-282 write), if any. */
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
  // Default per-day rate (50) — straight days × rate, below both caps
  // ───────────────────────────────────────────────────────────────────────────
  it('3 days overdue at default 50/day → late fee = 150.00 (below both caps)', async () => {
    // amountDue 10000 → pctCap = 10000 * 0.05 = 500; cap (default) = 1500.
    // min(50*3=150, 1500, 500) = 150.00
    prisma.payment.findFirst.mockResolvedValue(makePayment({ dueDate: overdueDays(3) }));

    await service.recordPayment(
      'lf-contract-1',
      1,
      10150, // amountDue(10000) + lateFee(150)
      'CASH',
      'user-1',
      'https://slip.test/3d',
      undefined,
      'LF-3DAY',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('150.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('150.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5% pctCap binds (per Thai law: LATE_FEE_CAP_PCT = 0.05)
  // ───────────────────────────────────────────────────────────────────────────
  it('5% pctCap clamps the fee when days × rate exceeds 5% of the installment', async () => {
    // amountDue 1000 → pctCap = 1000 * 0.05 = 50.
    // 10 days × default 50/day = 500; cap = 1500.
    // min(500, 1500, 50) = 50.00  ← pctCap wins
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ amountDue: D(1000), dueDate: overdueDays(10) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      1050, // amountDue(1000) + lateFee(50)
      'CASH',
      'user-1',
      'https://slip.test/pctcap',
      undefined,
      'LF-PCTCAP',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('50.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('50.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Absolute baht cap binds (configured per-day rate, large installment)
  // ───────────────────────────────────────────────────────────────────────────
  it('absolute late_fee_cap (1500 default) clamps the fee for a long-overdue large installment', async () => {
    // Configure 100/day; 40 days × 100 = 4000.
    // amountDue 100000 → pctCap = 5000; cap (default) = 1500.
    // min(4000, 1500, 5000) = 1500.00  ← absolute cap wins
    lateFeePerDayCfg = '100';
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ amountDue: D(100000), dueDate: overdueDays(40) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      101500, // amountDue(100000) + lateFee(1500)
      'CASH',
      'user-1',
      'https://slip.test/cap',
      undefined,
      'LF-CAP',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('1500.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('1500.00');
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
  // Stored fee already >= computed fee → no new write (only writes when greater)
  // ───────────────────────────────────────────────────────────────────────────
  it('does NOT lower an already-stored late fee (write only when computed > stored)', async () => {
    // Stored lateFee = 200; 3 days × 50 = 150 computed. 150 is NOT > 200, so the
    // stored 200 is kept and no lateFee-only Payment.update fires.
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ dueDate: overdueDays(3), lateFee: D(200) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      10200, // amountDue(10000) + stored lateFee(200)
      'CASH',
      'user-1',
      'https://slip.test/stored',
      undefined,
      'LF-STORED',
      '11-1101',
    );

    // No lateFee-only write (computed 150 did not exceed stored 200).
    expect(lateFeeWritten()).toBeUndefined();
    // The stored 200 IS still forwarded to the template (lateFee.gt(0)).
    expect(lateFeeForwarded()?.toFixed(2)).toBe('200.00');
  });
});
