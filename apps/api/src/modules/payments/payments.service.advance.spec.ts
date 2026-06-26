/**
 * Task 4 — payments.service.advance.spec.ts
 *
 * Tests for OVERPAY_ADVANCE / auto-consume advance balance logic added to
 * recordPayment. Uses mocked Prisma (unit style) — same pattern as payments.service.spec.ts.
 *
 * 4 test cases:
 *   1. Overpay → advanceBalance increments by overage
 *   2. Next installment auto-consumes advance, balance returns to 0
 *   3. Multi-overpay accumulates correctly
 *   4. Partial-cover: cash + advance fully clear installment
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
import { BadRequestException } from '@nestjs/common';
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

// ── installmentTotal used across tests (whole-number for simple assertions) ──
// financedAmount=10000, commission=0, interestTotal=2000, totalMonths=12, vatAmount=0
// grossExclVat = 10000 + 0 + 2000 = 12000
// installmentExclVat = floor(12000/12 * 100) / 100 = 1000.00 (ROUND_DOWN)
// vatPerInst = round(0/12, 2, ROUND_HALF_UP) = 0.00
// installmentTotal = 1000.00
const INST_TOTAL = 1000;

describe('PaymentsService — advance balance (Task 4)', () => {
  let service: PaymentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // PR-843/I2 Phase 3 3a — recordPayment now posts via the PaymentReceiptTemplate
  // primitive, so the partialClear/completion assertions target THIS mock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let receiptPrimitiveExecute: any;

  // Mutable advance balance that persists across tests (simulates DB state)
  let advanceBalance: number;

  // Simulate the installment amountDue + prevPaid state
  // Each test will override as needed
  const makeContract = (overrides = {}) => ({
    id: 'adv-contract-1',
    contractNumber: 'BC-ADV-001',
    status: 'ACTIVE',
    deletedAt: null,
    branchId: 'branch-1',
    customerId: 'cust-1',
    advanceBalance: D(advanceBalance),
    ...overrides,
  });

  const makePayment = (installmentNo: number, overrides = {}) => ({
    id: `adv-payment-${installmentNo}`,
    contractId: 'adv-contract-1',
    installmentNo,
    amountDue: INST_TOTAL,
    amountPaid: D(0),
    lateFee: D(0),
    lateFeeWaived: false,
    dueDate: new Date('2027-01-01'), // future — no late fee
    status: 'PENDING',
    evidenceUrl: null,
    notes: null,
    depositAccountCode: null,
    ...overrides,
  });

  beforeEach(async () => {
    advanceBalance = 0; // reset at start of each test

    // We need fresh mocks per test so contract.advanceBalance reflects current state
    const buildMockPrisma = () => ({
      contract: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve(makeContract({ advanceBalance: D(advanceBalance) })),
        ),
        update: jest.fn().mockImplementation(({ data }: { data: { advanceBalance?: { increment?: Prisma.Decimal } } }) => {
          // Simulate the increment update in-memory
          if (data.advanceBalance?.increment !== undefined) {
            const delta = parseFloat(data.advanceBalance.increment.toString());
            advanceBalance = parseFloat((advanceBalance + delta).toFixed(2));
          }
          return Promise.resolve(makeContract({ advanceBalance: D(advanceBalance) }));
        }),
      },
      payment: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }: { data: { amountPaid?: Prisma.Decimal; status?: string; paidDate?: Date | null } }) => {
          return Promise.resolve({
            id: 'adv-payment-x',
            contractId: 'adv-contract-1',
            installmentNo: 1,
            amountPaid: data.amountPaid ?? D(0),
            amountDue: D(INST_TOTAL),
            status: data.status ?? 'PENDING',
            paidDate: data.paidDate ?? null,
          });
        }),
        count: jest.fn().mockResolvedValue(1), // checkContractCompletion
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: INST_TOTAL, lateFee: 0 } }),
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve(makePayment(1)),
        ),
      },
      // Phase 4 draft/post split
      paymentDraft: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create, update }: { create: object; update: object }) =>
          Promise.resolve({ id: 'draft-1', ...create, ...update }),
        ),
        update: jest.fn().mockResolvedValue({ id: 'draft-1' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', defaultCashAccountCode: null, deletedAt: null }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null), // no period lock, no late-fee config
      },
      installmentSchedule: {
        // Lazy-gen recovery (#1170): count>0 → ensureInstallmentSchedules no-op.
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null), // template call skipped (instSched=null)
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
      feeWaiverApproval: {
        create: jest.fn().mockResolvedValue({ id: 'fwa-1' }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrismaInst)),
    });

    // We need the mock instance to reference itself inside $transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockPrismaInst: any = buildMockPrisma();
    prisma = mockPrismaInst;

    receiptPrimitiveExecute = jest
      .fn()
      .mockResolvedValue({ entryNo: 'JE-ADV', split: { principalRemainingAfter: D(0) } });

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
        {
          provide: JournalAutoService,
          useValue: {
            createPaymentJournal: jest.fn().mockResolvedValue('je-1'),
            createExpenseJournal: jest.fn(),
            createContractActivationJournal: jest.fn(),
            createBadDebtWriteOffJournal: jest.fn(),
            createCustomerCreditOverpaymentJournal: jest.fn().mockResolvedValue('je-2'),
            createCreditAllocationJournal: jest.fn().mockResolvedValue({ financeEntryId: 'je-3', shopEntryId: 'je-4' }),
          },
        },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn() } },
        {
          provide: LineOaService,
          useValue: { buildPaymentSuccess: jest.fn().mockReturnValue({}), sendFlexMessage: jest.fn() },
        },
        {
          provide: FlexTemplatesService,
          useValue: { paymentReceipt: jest.fn().mockReturnValue({ type: 'flex', altText: 'test', contents: {} }) },
        },
        {
          provide: QuickReplyService,
          useValue: { afterPayment: jest.fn().mockReturnValue([]) },
        },
        {
          provide: PromiseService,
          useValue: { findActivePromise: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: MdmLockService,
          useValue: { autoUnlock: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: PaymentReceiptTemplate,
          useValue: { execute: receiptPrimitiveExecute },
        },
        {
          provide: Vat60dayReversalTemplate,
          useValue: { execute: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: BadDebtService,
          useValue: { reverseStageOnPayment: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Overpay → Cr 21-1103 + Contract.advanceBalance += overage
  // ─────────────────────────────────────────────────────────────────────────────
  it('overpay → Contract.advanceBalance increments by overage', async () => {
    const overage = 50;
    const cashAmount = INST_TOTAL + overage; // 1050

    prisma.payment.findFirst.mockResolvedValue(makePayment(1));

    await service.recordPayment(
      'adv-contract-1',
      1,
      cashAmount,
      'CASH',
      'user-1',
      'https://slip.test/1',
      undefined,
      'TEST-1',
      '11-1101',
      undefined,
      'OVERPAY_ADVANCE',
    );

    // Contract.update should have been called with increment = +50
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'adv-contract-1' },
        data: expect.objectContaining({
          advanceBalance: expect.objectContaining({ increment: expect.anything() }),
        }),
      }),
    );

    // In-memory balance simulation: should now be 50
    expect(advanceBalance).toBeCloseTo(50, 2);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Next installment auto-consumes advance, balance returns to 0
  // ─────────────────────────────────────────────────────────────────────────────
  it('next installment auto-consumes advance → balance returns to 0', async () => {
    // Pre-condition: advance = 50 (from test 1 scenario)
    advanceBalance = 50;

    // Pay งวด 2 with cash = installmentTotal - 50 = 950 → consume 50 from advance
    const cashAmount = INST_TOTAL - 50; // 950

    prisma.payment.findFirst.mockResolvedValue(makePayment(2));

    const result = await service.recordPayment(
      'adv-contract-1',
      2,
      cashAmount,
      'CASH',
      'user-1',
      'https://slip.test/2',
      undefined,
      'TEST-2',
      '11-1101',
    );

    // Contract.update called with decrement (increment = -50)
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          advanceBalance: expect.objectContaining({ increment: expect.anything() }),
        }),
      }),
    );

    // After consuming 50, balance should be 0
    expect(advanceBalance).toBeCloseTo(0, 2);

    // Payment should be marked PAID (recordedAmountPaid = cash + advanceConsume = 950+50 = 1000)
    expect(result.status).toBe('PAID');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Multi-overpay accumulates correctly
  // ─────────────────────────────────────────────────────────────────────────────
  it('multi-overpay accumulates advance balance correctly', async () => {
    // First overpay +100
    prisma.payment.findFirst.mockResolvedValue(makePayment(3));

    await service.recordPayment(
      'adv-contract-1',
      3,
      INST_TOTAL + 100,
      'CASH',
      'user-1',
      'https://slip.test/3',
      undefined,
      'TEST-3',
      '11-1101',
      undefined,
      'OVERPAY_ADVANCE',
    );

    expect(advanceBalance).toBeCloseTo(100, 2);

    // Second overpay +200 (contract.findUnique will return advanceBalance=100 at this point)
    prisma.payment.findFirst.mockResolvedValue(makePayment(4));

    await service.recordPayment(
      'adv-contract-1',
      4,
      INST_TOTAL + 200,
      'CASH',
      'user-1',
      'https://slip.test/4',
      undefined,
      'TEST-4',
      '11-1101',
      undefined,
      'OVERPAY_ADVANCE',
    );

    expect(advanceBalance).toBeCloseTo(300, 2);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Partial-cover — cash + advance fully clears installment
  // ─────────────────────────────────────────────────────────────────────────────
  it('partial-cover: cash + advance fully clears installment, balance drops to 0', async () => {
    // Pre-condition: advance = 300 (from test 3 scenario)
    advanceBalance = 300;

    // Pay งวด 5 with cash = 700 → consume 300 from advance → total = 1000 (paid in full)
    const cashAmount = INST_TOTAL - 300; // 700

    prisma.payment.findFirst.mockResolvedValue(makePayment(5));

    const result = await service.recordPayment(
      'adv-contract-1',
      5,
      cashAmount,
      'CASH',
      'user-1',
      'https://slip.test/5',
      undefined,
      'TEST-5',
      '11-1101',
    );

    // Balance should be drained to 0
    expect(advanceBalance).toBeCloseTo(0, 2);

    // Payment should be marked PAID
    expect(result.status).toBe('PAID');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Regression: overpay ABOVE ceiling without OVERPAY_ADVANCE still throws
  // (50฿ overage on 1000฿ inst is now within default 2× ceiling → auto-routes)
  // Use 5×INST_TOTAL (overage = 4000, ceiling = 2000) to trigger the guard.
  // ─────────────────────────────────────────────────────────────────────────────
  it('overpay ABOVE ceiling without OVERPAY_ADVANCE case throws BadRequestException (regression)', async () => {
    prisma.payment.findFirst.mockResolvedValue(makePayment(6));

    await expect(
      service.recordPayment(
        'adv-contract-1',
        6,
        INST_TOTAL * 5, // overage = 4000 > ceiling 2000 → still throw
        'CASH',
        'user-1',
        'https://slip.test/6',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Task 5 / D1: bounded auto-route ceiling tests
  // ─────────────────────────────────────────────────────────────────────────────
  it('overpay within ceiling auto-parks as advance WITHOUT requiring OVERPAY_ADVANCE case', async () => {
    // INST_TOTAL = 1000, default ceiling = 2 × 1000 = 2000, overage = 50 < 2000
    prisma.payment.findFirst.mockResolvedValue(makePayment(10));

    await service.recordPayment(
      'adv-contract-1',
      10,
      INST_TOTAL + 50, // overage 50 < ceiling 2000 → auto-park
      'CASH',
      'user-1',
      'https://slip.test/10',
    );

    // advanceBalance should have incremented by 50
    expect(advanceBalance).toBeCloseTo(50, 2);
  });

  it('overpay ABOVE ceiling still throws without explicit OVERPAY_ADVANCE case (typo guard)', async () => {
    // INST_TOTAL = 1000, default ceiling = 2000, overage = 4000 → throw
    prisma.payment.findFirst.mockResolvedValue(makePayment(11));

    await expect(
      service.recordPayment(
        'adv-contract-1',
        11,
        INST_TOTAL * 5, // overage 4000 > ceiling 2000 → throw
        'CASH',
        'user-1',
        'https://slip.test/11',
      ),
    ).rejects.toThrow(/เกินยอดค้างชำระ/);
  });

  it('overpay above ceiling WITH explicit OVERPAY_ADVANCE case is allowed', async () => {
    // INST_TOTAL = 1000, overage = 4000 > ceiling 2000, but explicit case bypasses guard
    prisma.payment.findFirst.mockResolvedValue(makePayment(12));

    await service.recordPayment(
      'adv-contract-1',
      12,
      INST_TOTAL * 5, // overage 4000 > ceiling, but OVERPAY_ADVANCE bypasses
      'CASH',
      'user-1',
      'https://slip.test/12',
      undefined,
      'TEST-5C',
      '11-1101',
      undefined,
      'OVERPAY_ADVANCE',
    );

    // advanceBalance should have incremented by 4000
    expect(advanceBalance).toBeCloseTo(4000, 2);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PARTIAL case tests (Task 2)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('PARTIAL case', () => {
    it('partial 800 of 1000 → status PARTIALLY_PAID, isFinalReceipt:false (delta) passed to primitive', async () => {
      // Return an installmentSchedule so the primitive is actually called
      prisma.installmentSchedule.findUnique.mockResolvedValueOnce({ id: 'sch-partial-1' });
      prisma.payment.findFirst.mockResolvedValueOnce(makePayment(7));

      await service.recordPayment(
        'adv-contract-1',
        7,
        800, // 200 shortage → requires PARTIAL
        'CASH',
        'user-1',
        undefined,
        undefined,
        'TEST-P1',
        '11-1101',
        undefined,
        'PARTIAL',
      );

      // PR-843/I2 Phase 3 3a — recordPayment now posts via the primitive.
      // partialClear:true → isFinalReceipt:false; amountReceived → delta (per-call DELTA).
      // The primitive receives the tx as the 2nd positional arg.
      expect(receiptPrimitiveExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          installmentScheduleId: 'sch-partial-1',
          isFinalReceipt: false,
          delta: expect.objectContaining({ toString: expect.any(Function) }),
        }),
        expect.anything(),
      );
      // delta == 800 (the per-call amount).
      const args = receiptPrimitiveExecute.mock.calls[0][0];
      expect(args.delta.toString()).toBe('800');

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PARTIALLY_PAID' }),
        }),
      );
    });

    it('shortage > 1฿ without case=PARTIAL throws BadRequestException', async () => {
      prisma.payment.findFirst.mockResolvedValueOnce(makePayment(8));

      await expect(
        service.recordPayment(
          'adv-contract-1',
          8,
          800, // 200 shortage — no explicit PARTIAL case
          'CASH',
          'user-1',
          undefined,
          undefined,
          'TEST-P2',
          '11-1101',
        ),
      ).rejects.toThrow(/PARTIAL/);
    });

    it('re-pay full remainder after partial → status PAID, primitive called with delta=200, isFinalReceipt:true (no throw)', async () => {
      // Simulate installment 9 with prevPaid = 800 (PARTIALLY_PAID)
      prisma.payment.findFirst.mockResolvedValueOnce(
        makePayment(9, { amountPaid: D(800), status: 'PARTIALLY_PAID' }),
      );
      // Return an installmentSchedule for the primitive call
      prisma.installmentSchedule.findUnique.mockResolvedValueOnce({ id: 'sch-partial-3' });

      // PR-843/I2 Phase 3 3a — THE footgun that was HIDDEN by mocking the 2B
      // template. With the primitive, completing a prior partial forwards the
      // per-call DELTA (200) + isFinalReceipt:true; the primitive reconstructs
      // the prior 800 cleared and clears ONLY the 200 remaining — no
      // "exceeds tolerance" throw (which the real 2B non-partialClear path would
      // have raised on roundingDiff ≈ 200 − 1000 = −800).
      await service.recordPayment(
        'adv-contract-1',
        9,
        200, // 800 prevPaid + 200 cash = 1000 = PAID in full
        'CASH',
        'user-1',
        undefined,
        undefined,
        'TEST-P3',
        '11-1101',
      );

      // isFinalReceipt must be TRUE (completing receipt), delta = 200 (per-call DELTA).
      expect(receiptPrimitiveExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          installmentScheduleId: 'sch-partial-3',
          isFinalReceipt: true,
        }),
        expect.anything(),
      );
      const args = receiptPrimitiveExecute.mock.calls[0][0];
      expect(args.delta.toString()).toBe('200');

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T4: consumeAdvance flag — the credit-deduction checkbox gates the auto-consume
  // ─────────────────────────────────────────────────────────────────────────────
  // recordPayment positional args (12): contractId, installmentNo, amount,
  // paymentMethod, recordedById, evidenceUrl, notes, transactionRef,
  // depositAccountCode, toleranceApproverId, paymentCase, consumeAdvance.
  describe('consumeAdvance flag (T4)', () => {
    it('consumeAdvance=false → no auto-consume; a net underpay hits the PARTIAL guard', async () => {
      advanceBalance = 50;
      prisma.payment.findFirst.mockResolvedValue(makePayment(20));
      await expect(
        service.recordPayment(
          'adv-contract-1', 20, INST_TOTAL - 50, 'CASH', 'user-1',
          'https://slip.test/20', undefined, 'TEST-NOCONSUME', '11-1101',
          undefined, undefined, false,
        ),
      ).rejects.toThrow(/PARTIAL/);
      expect(advanceBalance).toBeCloseTo(50, 2); // advance untouched
    });

    it('consumeAdvance=false + pays full → PAID, advance left intact', async () => {
      advanceBalance = 50;
      prisma.payment.findFirst.mockResolvedValue(makePayment(21));
      const result = await service.recordPayment(
        'adv-contract-1', 21, INST_TOTAL, 'CASH', 'user-1',
        'https://slip.test/21', undefined, 'TEST-FULL-NOCONSUME', '11-1101',
        undefined, undefined, false,
      );
      expect(result.status).toBe('PAID');
      expect(advanceBalance).toBeCloseTo(50, 2); // NOT consumed
    });

    it('consumeAdvance=true (default) → net underpay auto-consumes, balance to 0, PAID', async () => {
      advanceBalance = 50;
      prisma.payment.findFirst.mockResolvedValue(makePayment(22));
      const result = await service.recordPayment(
        'adv-contract-1', 22, INST_TOTAL - 50, 'CASH', 'user-1',
        'https://slip.test/22', undefined, 'TEST-CONSUME', '11-1101',
        undefined, undefined, true,
      );
      expect(result.status).toBe('PAID');
      expect(advanceBalance).toBeCloseTo(0, 2); // consumed
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // T7: backdated paidDate (param 13) — stamped on the Payment; future date rejected
  // ─────────────────────────────────────────────────────────────────────────────
  describe('backdated paidDate (T7)', () => {
    it('backdated paidDate is stamped on the Payment (full pay, future dueDate = no late fee)', async () => {
      const backdated = new Date('2026-03-15T00:00:00.000Z');
      prisma.payment.findFirst.mockResolvedValue(makePayment(40)); // dueDate 2027 (future)
      await service.recordPayment(
        'adv-contract-1', 40, INST_TOTAL, 'CASH', 'user-1',
        'https://slip.test/40', undefined, 'TEST-BACKDATE', '11-1101',
        undefined, undefined, true, backdated,
      );
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paidDate: backdated }),
        }),
      );
    });

    it('future paidDate → BadRequestException', async () => {
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      prisma.payment.findFirst.mockResolvedValue(makePayment(41));
      await expect(
        service.recordPayment(
          'adv-contract-1', 41, INST_TOTAL, 'CASH', 'user-1',
          'https://slip.test/41', undefined, 'TEST-FUTURE', '11-1101',
          undefined, undefined, true, future,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('omitted paidDate → defaults to now, Payment marked PAID', async () => {
      prisma.payment.findFirst.mockResolvedValue(makePayment(42));
      const result = await service.recordPayment(
        'adv-contract-1', 42, INST_TOTAL, 'CASH', 'user-1',
        'https://slip.test/42', undefined, 'TEST-NODATE', '11-1101',
      );
      expect(result.status).toBe('PAID');
    });

    it('late fee is computed as of paidDate, not now (W5: backdated → fewer days overdue)', async () => {
      const dueDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const paidDate = new Date(dueDate.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days overdue AS OF paid date
      prisma.payment.findFirst.mockResolvedValue(makePayment(43, { dueDate, lateFee: D(0) }));
      // PER_DAY: rate=10, max=100000, cap=100% → fee = daysOverdue × 10 (no cap binding)
      prisma.systemConfig.findUnique.mockImplementation(
        ({ where: { key } }: { where: { key: string } }) => {
          const map: Record<string, string> = {
            late_fee_mode: 'PER_DAY',
            late_fee_per_day_rate: '10',
            late_fee_max_amount: '100000',
            late_fee_cap_pct: '100',
          };
          return Promise.resolve(map[key] ? { value: map[key] } : null);
        },
      );

      await service.recordPayment(
        'adv-contract-1', 43, INST_TOTAL + 20, 'CASH', 'user-1',
        'https://slip.test/43', undefined, 'TEST-LF-BACKDATE', '11-1101',
        undefined, undefined, true, paidDate,
      );

      // The late-fee update must reflect 2 days overdue (= 20), NOT ~30 days (= 300 / capped).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lfUpdate = prisma.payment.update.mock.calls
        .map((c: any) => c[0])
        .find((a: any) => a?.data?.lateFee !== undefined);
      expect(lfUpdate).toBeDefined();
      expect(new Prisma.Decimal(lfUpdate.data.lateFee.toString()).toNumber()).toBe(20);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // P2 (D1): gross late-fee waiver — params 14/15/16 (amount, reasonCode, approverId)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('gross late-fee waiver (P2)', () => {
    const PER_DAY = ({ where: { key } }: { where: { key: string } }) => {
      const map: Record<string, string> = {
        late_fee_mode: 'PER_DAY', late_fee_per_day_rate: '10',
        late_fee_max_amount: '100000', late_fee_cap_pct: '100',
      };
      return Promise.resolve(map[key] ? { value: map[key] } : null);
    };
    // 5 days overdue × rate 10 → gross late fee = 50
    const dueDate5 = () => new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    it('golden: gross 50, waive 25 → cash 1025 closes; waivedAmount + FeeWaiverApproval + template lateFeeWaived', async () => {
      prisma.systemConfig.findUnique.mockImplementation(PER_DAY);
      prisma.payment.findFirst.mockResolvedValue(makePayment(60, { dueDate: dueDate5(), lateFee: D(0) }));
      prisma.user.findUnique.mockResolvedValue({ id: 'approver-1', role: 'FINANCE_MANAGER', isActive: true, deletedAt: null });
      prisma.installmentSchedule.findUnique.mockResolvedValue({ id: 'sch-waive-1', vat60dayJournalEntryId: null });

      const result = await service.recordPayment(
        'adv-contract-1', 60, INST_TOTAL + 25, 'CASH', 'user-1',
        'https://slip.test/60', undefined, 'TEST-WAIVE', '11-1101',
        undefined, undefined, true, undefined,
        25, 'goodwill', 'approver-1',
      );

      expect(result.status).toBe('PAID');

      // Payment.update carries the waiver fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wUpdate = prisma.payment.update.mock.calls
        .map((c: any) => c[0])
        .find((a: any) => a?.data?.waivedAmount !== undefined);
      expect(wUpdate).toBeDefined();
      expect(new Prisma.Decimal(wUpdate.data.waivedAmount.toString()).toNumber()).toBe(25);
      expect(wUpdate.data.lateFeeWaived).toBe(true);
      expect(wUpdate.data.waivedApprovedById).toBe('approver-1');

      // Immutable 4-eyes evidence
      expect(prisma.feeWaiverApproval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ approverId: 'approver-1' }) }),
      );

      // Template receives gross lateFee (50) + waived (25) → it books Cr 42-1103 gross + Dr 52-1105
      const tArgs = receiptPrimitiveExecute.mock.calls[0][0];
      expect(new Prisma.Decimal(tArgs.lateFee.toString()).toNumber()).toBe(50);
      expect(new Prisma.Decimal(tArgs.lateFeeWaived.toString()).toNumber()).toBe(25);
    });

    it('SoD: approver === recorder → ForbiddenException', async () => {
      prisma.payment.findFirst.mockResolvedValue(makePayment(61, { dueDate: dueDate5() }));
      await expect(
        service.recordPayment(
          'adv-contract-1', 61, INST_TOTAL + 25, 'CASH', 'user-1',
          'https://slip.test/61', undefined, 'TEST-WAIVE-SOD', '11-1101',
          undefined, undefined, true, undefined,
          25, 'goodwill', 'user-1', // approver === recorder
        ),
      ).rejects.toThrow(/Segregation of Duties/);
    });

    it('waiver without approverId → BadRequestException', async () => {
      prisma.payment.findFirst.mockResolvedValue(makePayment(62, { dueDate: dueDate5() }));
      await expect(
        service.recordPayment(
          'adv-contract-1', 62, INST_TOTAL + 25, 'CASH', 'user-1',
          'https://slip.test/62', undefined, 'TEST-WAIVE-NOAPP', '11-1101',
          undefined, undefined, true, undefined,
          25, 'goodwill', undefined,
        ),
      ).rejects.toThrow(/ผู้อนุมัติ/);
    });

    it('waiver > gross late fee → BadRequestException', async () => {
      prisma.systemConfig.findUnique.mockImplementation(PER_DAY);
      prisma.payment.findFirst.mockResolvedValue(makePayment(63, { dueDate: dueDate5(), lateFee: D(0) }));
      prisma.user.findUnique.mockResolvedValue({ id: 'approver-1', role: 'OWNER', isActive: true, deletedAt: null });
      await expect(
        service.recordPayment(
          'adv-contract-1', 63, INST_TOTAL, 'CASH', 'user-1',
          'https://slip.test/63', undefined, 'TEST-WAIVE-OVER', '11-1101',
          undefined, undefined, true, undefined,
          999, 'goodwill', 'approver-1', // 999 > gross 50
        ),
      ).rejects.toThrow(/เกินค่าปรับ/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 4: draft/post split (บันทึก Draft → ลงบัญชี)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('draft/post split (Phase 4)', () => {
    it('saveDraft stores params WITHOUT posting a JE (no money movement)', async () => {
      prisma.payment.findFirst.mockResolvedValue(makePayment(70));
      await service.saveDraft(
        'adv-contract-1', 70,
        { amount: INST_TOTAL, paymentMethod: 'CASH', consumeAdvance: true },
        'user-1',
      );
      expect(prisma.paymentDraft.upsert).toHaveBeenCalled();
      expect(receiptPrimitiveExecute).not.toHaveBeenCalled(); // no JE while draft
      expect(prisma.payment.update).not.toHaveBeenCalled(); // nothing booked
    });

    it('saveDraft rejects a PAID installment', async () => {
      prisma.payment.findFirst.mockResolvedValue(makePayment(71, { status: 'PAID' }));
      await expect(
        service.saveDraft('adv-contract-1', 71, { amount: INST_TOTAL, paymentMethod: 'CASH' }, 'user-1'),
      ).rejects.toThrow(/ชำระแล้ว/);
    });

    it('postDraft runs recordPayment (posts JE) then retires the draft', async () => {
      prisma.paymentDraft.findFirst.mockResolvedValue({
        id: 'draft-9', paymentId: 'adv-payment-9', amount: D(INST_TOTAL), paymentMethod: 'CASH',
        depositAccountCode: '11-1101', consumeAdvance: true, transactionRef: 'TEST-DRAFT-9',
        evidenceUrl: null, notes: null, paidDate: null, paymentCase: null,
        lateFeeWaiverAmount: null, lateFeeWaiverReasonCode: null, waiverApproverId: null,
        createdById: 'maker-1', // recordedById = maker (preserves SoD vs approver)
      });
      prisma.payment.findUnique.mockResolvedValue(makePayment(9));
      prisma.payment.findFirst.mockResolvedValue(makePayment(9));
      prisma.installmentSchedule.findUnique.mockResolvedValue({ id: 'sch-9', vat60dayJournalEntryId: null });

      await service.postDraft('adv-payment-9', 'manager-1');

      expect(receiptPrimitiveExecute).toHaveBeenCalled(); // JE posted on post
      expect(prisma.paymentDraft.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });

    it('cancelDraft soft-deletes the draft', async () => {
      prisma.paymentDraft.findFirst.mockResolvedValue({ id: 'draft-c', paymentId: 'adv-payment-c' });
      await service.cancelDraft('adv-payment-c');
      expect(prisma.paymentDraft.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });
  });
});
