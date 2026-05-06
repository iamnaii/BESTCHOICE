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
import { PaymentReceipt2BTemplate } from '../journal/cpa-templates/payment-receipt-2b.template';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let receipt2BExecute: any;

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
        findUnique: jest.fn().mockResolvedValue(null), // template call skipped (instSched=null)
      },
      callLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'al-1' }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrismaInst)),
    });

    // We need the mock instance to reference itself inside $transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockPrismaInst: any = buildMockPrisma();
    prisma = mockPrismaInst;

    receipt2BExecute = jest.fn().mockResolvedValue({ entryNo: 'JE-ADV' });

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
          provide: PaymentReceipt2BTemplate,
          useValue: { execute: receipt2BExecute },
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
  // Regression: overpay without OVERPAY_ADVANCE case still throws
  // ─────────────────────────────────────────────────────────────────────────────
  it('overpay > 1฿ without OVERPAY_ADVANCE case throws BadRequestException (regression)', async () => {
    prisma.payment.findFirst.mockResolvedValue(makePayment(6));

    await expect(
      service.recordPayment(
        'adv-contract-1',
        6,
        INST_TOTAL + 50,
        'CASH',
        'user-1',
        'https://slip.test/6',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PARTIAL case tests (Task 2)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('PARTIAL case', () => {
    it('partial 800 of 1000 → status PARTIALLY_PAID, partialClear flag passed to template', async () => {
      // Return an installmentSchedule so the template is actually called
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

      expect(receipt2BExecute).toHaveBeenCalledWith(
        expect.objectContaining({ partialClear: true }),
      );

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

    it('re-pay full remainder after partial → status PAID, partialClear NOT passed', async () => {
      // Simulate installment 9 with prevPaid = 800 (PARTIALLY_PAID)
      prisma.payment.findFirst.mockResolvedValueOnce(
        makePayment(9, { amountPaid: D(800), status: 'PARTIALLY_PAID' }),
      );
      // Return an installmentSchedule for the template call
      prisma.installmentSchedule.findUnique.mockResolvedValueOnce({ id: 'sch-partial-3' });

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

      // partialClear should NOT be set (shortage = 0)
      expect(receipt2BExecute).toHaveBeenCalledWith(
        expect.not.objectContaining({ partialClear: true }),
      );

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });
  });
});
