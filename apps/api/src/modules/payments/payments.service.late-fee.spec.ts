/**
 * payments.service.late-fee.spec.ts
 *
 * Characterization (golden) test for the REAL-TIME late-fee computation in
 * PaymentsService.recordPayment via the payment-receipt-orchestrator.
 *
 * The late fee is recomputed at payment time using the mode-aware resolveLateFee
 * dispatcher (PER_DAY by default, D2 Section #3, feat/late-fee-perday):
 *
 *   PER_DAY (default):
 *     daysOverdue   = floor((now - dueDate) / 1 day)
 *     lateFee       = min(daysOverdue × ratePerDay, maxAmount, capPct% × amountDue)
 *     Defaults:     rate=20฿/day, max=500฿, cap=5%
 *
 *   BRACKET (rollback path via late_fee_mode=BRACKET SystemConfig):
 *     Same tier1/tier2 logic as before.
 *
 * Updated from bracket values in feat/late-fee-perday Task 2 — all golden
 * assertions now reflect PER_DAY defaults (rate=20, max=500, cap=5%).
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

describe('PaymentsService — real-time late fee on payment (PER_DAY mode)', () => {
  let service: PaymentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // PR-843/I2 Phase 3 3a — recordPayment now posts via the PaymentReceiptTemplate
  // primitive, so the forwarded-lateFee assertions target THIS mock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let receiptPrimitiveExecute: any;

  // Per-test config overrides for SystemConfig keys (null = use BUSINESS_RULES default).
  let lateFeeModeCfg: string | null;
  let lateFeeT1Cfg: string | null;
  let lateFeeT2Cfg: string | null;
  let lateFeeT2MinDaysCfg: string | null;
  let lateFeePerDayRateCfg: string | null;
  let lateFeeMaxAmountCfg: string | null;
  let lateFeeCapPctCfg: string | null;

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
    lateFeeModeCfg = null;
    lateFeeT1Cfg = null;
    lateFeeT2Cfg = null;
    lateFeeT2MinDaysCfg = null;
    lateFeePerDayRateCfg = null;
    lateFeeMaxAmountCfg = null;
    lateFeeCapPctCfg = null;

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
        // Key-aware dispatch: all late-fee keys respond to per-test config vars;
        // other keys (period-lock, etc.) return null (open period / no config).
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { key: string } }) => {
            const map: Record<string, string | null> = {
              late_fee_mode: lateFeeModeCfg,
              late_fee_tier1_amount: lateFeeT1Cfg,
              late_fee_tier2_amount: lateFeeT2Cfg,
              late_fee_tier2_min_days: lateFeeT2MinDaysCfg,
              late_fee_per_day_rate: lateFeePerDayRateCfg,
              late_fee_max_amount: lateFeeMaxAmountCfg,
              late_fee_cap_pct: lateFeeCapPctCfg,
            };
            const val = map[where.key] ?? null;
            return Promise.resolve(val ? { value: val } : null);
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
  // PER_DAY 1 day: 1 × 20฿ = 20฿ (rate wins, cap not binding for amountDue=10000)
  // ───────────────────────────────────────────────────────────────────────────
  it('1 day overdue → per-day fee = 20.00 (1 day × 20฿/day, min(20,500,5%×10000=500)=20)', async () => {
    // Updated from bracket tier1=50 to per-day 20 in feat/late-fee-perday Task 2.
    prisma.payment.findFirst.mockResolvedValue(makePayment({ dueDate: overdueDays(1) }));

    await service.recordPayment(
      'lf-contract-1',
      1,
      10020, // amountDue(10000) + lateFee(20)
      'CASH',
      'user-1',
      'https://slip.test/1d',
      undefined,
      'LF-1DAY',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('20.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('20.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PER_DAY 3 days: 3 × 20฿ = 60฿ (rate wins for amountDue=10000)
  // ───────────────────────────────────────────────────────────────────────────
  it('3 days overdue → per-day fee = 60.00 (3 × 20฿, min(60,500,5%×10000=500)=60)', async () => {
    // Updated from bracket tier2=100 to per-day 60 in feat/late-fee-perday Task 2.
    prisma.payment.findFirst.mockResolvedValue(makePayment({ dueDate: overdueDays(3) }));

    await service.recordPayment(
      'lf-contract-1',
      1,
      10060, // amountDue(10000) + lateFee(60)
      'CASH',
      'user-1',
      'https://slip.test/3d',
      undefined,
      'LF-3DAY',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('60.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('60.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PER_DAY 10 days, small installment: 5% cap binds
  // 10 × 20 = 200, min(200, 500, 5%×1000=50) = 50
  // ───────────────────────────────────────────────────────────────────────────
  it('10 days overdue, amountDue=1000 → 5% cap binds = 50.00 (min(200,500,50))', async () => {
    // Updated from bracket tier2=100 to per-day 5%-capped 50 in feat/late-fee-perday Task 2.
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ amountDue: D(1000), dueDate: overdueDays(10) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      1050, // amountDue(1000) + lateFee(50)
      'CASH',
      'user-1',
      'https://slip.test/10d',
      undefined,
      'LF-10DAY',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('50.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('50.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Config-driven: per-day rate override from SystemConfig
  // rate=50/day, 3 days, amountDue=100000 → 3×50=150, min(150,500,5000)=150
  // ───────────────────────────────────────────────────────────────────────────
  it('SystemConfig overrides: per-day rate=50 → 3 days = 150.00', async () => {
    // Updated from bracket tier2=200 test to per-day rate override test.
    lateFeePerDayRateCfg = '50';
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ amountDue: D(100000), dueDate: overdueDays(3) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      100150, // amountDue(100000) + lateFee(150)
      'CASH',
      'user-1',
      'https://slip.test/cfg',
      undefined,
      'LF-CFG',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('150.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('150.00');
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
  // No change when stored fee already equals the resolved fee
  // PER_DAY: 3 days × 20 = 60, 5%×10000=500. Stored=60 → no write.
  // ───────────────────────────────────────────────────────────────────────────
  it('no Payment.update write when stored lateFee already equals the resolved per-day fee', async () => {
    // Updated: stored=60 matches PER_DAY resolved=60 → no write.
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ dueDate: overdueDays(3), lateFee: D(60) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      10060, // amountDue(10000) + stored lateFee(60)
      'CASH',
      'user-1',
      'https://slip.test/equal',
      undefined,
      'LF-EQUAL',
      '11-1101',
    );

    // No lateFee-only write (computed 60 equals stored 60).
    expect(lateFeeWritten()).toBeUndefined();
    // The stored 60 IS still forwarded to the template (lateFee.gt(0)).
    expect(lateFeeForwarded()?.toFixed(2)).toBe('60.00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Retroactive adjustment: stored 200฿ → resolved per-day 75.79฿ (5% cap)
  // 10 days × 20 = 200, 5% × 1515.83 = 75.79 → min(200,500,75.79) = 75.79
  // ───────────────────────────────────────────────────────────────────────────
  it('retroactive adjustment: a stored 200฿ fee recomputes DOWN to 75.79฿ (5% cap on 1515.83)', async () => {
    // Updated from bracket 100 to per-day 75.79 (the CPA golden example).
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ dueDate: overdueDays(10), lateFee: D(200), amountDue: D(1515.83) }),
    );

    // Act: record a payment. Amount = amountDue(1515.83) + resolved(75.79) = 1591.62.
    await service.recordPayment(
      'lf-contract-1',
      1,
      1591.62,
      'CASH',
      'user-1',
      'https://slip.test/retro',
      undefined,
      'LF-RETRO',
      '11-1101',
    );

    // Assert: stored lateFee was SET to the resolved per-day fee.
    expect(lateFeeWritten()?.toFixed(2)).toBe('75.79');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('75.79');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BRACKET rollback: when late_fee_mode=BRACKET, reverts to old tier behavior
  // ───────────────────────────────────────────────────────────────────────────
  it('BRACKET mode rollback: 3 days overdue → tier2 = 100.00 (configured via SystemConfig)', async () => {
    lateFeeModeCfg = 'BRACKET';
    lateFeeT2Cfg = '100';
    lateFeeT2MinDaysCfg = '3';
    prisma.payment.findFirst.mockResolvedValue(
      makePayment({ amountDue: D(10000), dueDate: overdueDays(3) }),
    );

    await service.recordPayment(
      'lf-contract-1',
      1,
      10100, // amountDue(10000) + bracket lateFee(100)
      'CASH',
      'user-1',
      'https://slip.test/bracket',
      undefined,
      'LF-BRACKET',
      '11-1101',
    );

    expect(lateFeeWritten()?.toFixed(2)).toBe('100.00');
    expect(lateFeeForwarded()?.toFixed(2)).toBe('100.00');
  });
});
