import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BadDebtService } from './bad-debt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { BadDebtProvisionTemplate } from '../journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import * as Sentry from '@sentry/nestjs';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';
import { CreditNoteDocumentService } from '../receipts/services/credit-note-document.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

// jest has no built-in Decimal matcher — compare via toFixed(2) string equality.
expect.extend({
  decimalEq(received: any, expected: string) {
    const pass =
      received != null &&
      typeof received.toFixed === 'function' &&
      received.toFixed(2) === new Prisma.Decimal(expected).toFixed(2);
    return { pass, message: () => `expected Decimal ${received} to equal ${expected}` };
  },
});
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Expect {
      decimalEq(expected: string): any;
    }
  }
}

/**
 * BadDebtService is the financial provisioning engine. It maps overdue
 * payments into aging buckets, applies bucket-specific provision rates,
 * and writes BadDebtProvision records that the P&L statement reads from.
 *
 * Tests focus on:
 *  - aging bucket boundary correctness (off-by-one bugs would shift
 *    millions of baht between provision rates)
 *  - the rule "previous ACTIVE provisions must be REVERSED first" so
 *    re-running calculation doesn't double-count
 *  - the segregation-of-duties rule on writeOffBadDebt (writer != approver)
 *  - filter scoping (only contracts in scope are reversed)
 */
describe('BadDebtService', () => {
  let service: BadDebtService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let provisionTemplateMock: { execute: jest.Mock };
  let eclStageReverseTemplateMock: { execute: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let creditNoteService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cnDeliveryServiceMock: any;
  let consecutiveMissedMock: { getStreaks: jest.Mock };

  // 17k/12m fixture — same canonical contract used across the codebase
  // (apps/api/src/modules/journal/__tests__/scenario-helpers.ts
  // seedStandard17k12m): financedAmount 10,000 + storeCommission 1,000 +
  // interestTotal 6,000 = grossExclVat 17,000; vatAmount 1,190; totalMonths
  // 12 → installmentTotal = 1,515.83 (.claude/rules/accounting.md rounding:
  // 17000/12 ROUND_DOWN=1,416.66, 1190/12 ROUND_HALF_UP=99.17, sum=1,515.83).
  // The per-installment ECL engine (computeInstallmentOutstanding) needs
  // these fields on every mocked payment's `contract` sub-object.
  const STD_CONTRACT_FIELDS = {
    totalMonths: 12,
    financedAmount: new Prisma.Decimal('10000.00'),
    storeCommission: new Prisma.Decimal('1000.00'),
    interestTotal: new Prisma.Decimal('6000.00'),
    vatAmount: new Prisma.Decimal('1190.00'),
  };
  const INSTALLMENT_TOTAL = 1515.83;

  // Full (unpaid) installment payment row at a given dueDate offset (days
  // ago). amountDue = installmentTotal so the engine's fee-netted clamp to
  // [0, installmentTotal] never truncates it — outstanding = installmentTotal
  // exactly, matching the 2026-07-26 per-installment plan's goldens.
  const makeFullPayment = (contractId: string, daysAgo: number, installmentNo = 1) => ({
    id: `pay-${contractId}-${installmentNo}-${daysAgo}`,
    contractId,
    installmentNo,
    amountDue: new Prisma.Decimal(INSTALLMENT_TOTAL.toFixed(2)),
    amountPaid: new Prisma.Decimal(0),
    lateFee: new Prisma.Decimal(0),
    lateFeeWaived: false,
    status: 'PENDING',
    dueDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    contract: { id: contractId, ...STD_CONTRACT_FIELDS },
  });

  beforeEach(async () => {
    prisma = {
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null), // use defaults
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalLine: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      badDebtProvision: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      badDebtWriteOffAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'wo-audit-1' }),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where: { id } }) =>
          Promise.resolve({
            id,
            role: id.startsWith('owner') ? 'OWNER'
              : id.startsWith('fm') ? 'FINANCE_MANAGER'
              : id.startsWith('acct') ? 'ACCOUNTANT'
              : id.startsWith('bm') ? 'BRANCH_MANAGER'
              : 'SALES',
            isActive: true,
            deletedAt: null,
          }),
        ),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => {
        if (typeof fn === 'function') {
          return fn(prisma);
        }
        return Promise.all(fn);
      }),
    };

    provisionTemplateMock = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) };
    eclStageReverseTemplateMock = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-ECL-MOCK' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadDebtService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JournalAutoService,
          useValue: {
            createBadDebtWriteOffJournal: jest.fn().mockResolvedValue('je-mock'),
            createBadDebtProvisionJournal: jest.fn().mockResolvedValue('je-provision-mock'),
          },
        },
        { provide: BadDebtProvisionTemplate, useValue: provisionTemplateMock },
        { provide: BadDebtWriteOffTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
        { provide: EclStageReverseTemplate, useValue: eclStageReverseTemplateMock },
        {
          provide: ConsecutiveMissedService,
          useValue: (consecutiveMissedMock = { getStreaks: jest.fn().mockResolvedValue(new Map()) }),
        },
        {
          provide: CreditNoteDocumentService,
          useValue: (creditNoteService = {
            issueForContract: jest.fn().mockResolvedValue({
              outcome: 'ISSUED',
              receiptId: 'r1',
              receiptNumber: 'RT-x',
            }),
          }),
        },
        {
          provide: CreditNoteDeliveryService,
          useValue: (cnDeliveryServiceMock = {
            deliver: jest.fn().mockResolvedValue({ delivered: true }),
          }),
        },
      ],
    }).compile();

    service = module.get<BadDebtService>(BadDebtService);
  });

  describe('calculateProvisions — aging bucket boundaries (per-installment engine, 2026-07-26)', () => {
    // Full-installment payment row at a given dueDate offset (days ago).
    // amountDue = installmentTotal (1,515.83 on the 17k/12 fixture — see
    // STD_CONTRACT_FIELDS above) so the engine's fee-netted clamp to
    // [0, installmentTotal] never truncates it — outstanding = installmentTotal
    // exactly, matching the 2026-07-26 per-installment plan's goldens.
    it('places a 30-day overdue installment in the 1-30 bucket (boundary inclusive) — golden 30.32', async () => {
      prisma.payment.findMany.mockResolvedValue([makeFullPayment('c1', 30)]);

      const result = await service.calculateProvisions('user-1');

      expect(result.created).toBe(1);
      expect(result.byBucket['1-30']).toBeDefined();
      // 1,515.83 × 0.02 = 30.3166 → ROUND_HALF_UP 2dp = 30.32
      expect(result.byBucket['1-30'].amount).toBeCloseTo(30.32, 2);
    });

    it('places a 31-day overdue installment in the 31-60 bucket (boundary, B2)', async () => {
      prisma.payment.findMany.mockResolvedValue([makeFullPayment('c1', 31)]);
      const result = await service.calculateProvisions('user-1');
      // 1,515.83 × 0.15 = 227.3745 → 227.37
      expect(result.byBucket['31-60'].amount).toBeCloseTo(227.37, 2);
    });

    it('places a 61-day overdue installment in the 61-90 bucket (B3 → terminate)', async () => {
      prisma.payment.findMany.mockResolvedValue([makeFullPayment('c1', 61)]);
      const result = await service.calculateProvisions('user-1');
      // 1,515.83 × 0.50 = 757.915 → 757.92 (ROUND_HALF_UP)
      expect(result.byBucket['61-90'].amount).toBeCloseTo(757.92, 2);
    });

    it('places a 91-day overdue installment in the 91-180 bucket (B4)', async () => {
      prisma.payment.findMany.mockResolvedValue([makeFullPayment('c1', 91)]);
      const result = await service.calculateProvisions('user-1');
      // 1,515.83 × 0.75 = 1,136.8725 → 1,136.87
      expect(result.byBucket['91-180'].amount).toBeCloseTo(1136.87, 2);
    });

    it('places a 181-day overdue installment in the 180+ bucket (B5 NPL)', async () => {
      prisma.payment.findMany.mockResolvedValue([makeFullPayment('c1', 181)]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['180+'].amount).toBeCloseTo(INSTALLMENT_TOTAL, 2); // 100%
    });

    it('places a 361-day overdue installment in the 180+ bucket (still B5)', async () => {
      prisma.payment.findMany.mockResolvedValue([makeFullPayment('c1', 361)]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['180+'].amount).toBeCloseTo(INSTALLMENT_TOTAL, 2); // CPA collapses 180+ into single bucket
    });
  });

  describe('calculateProvisions — per-installment scenario series (2026-07-26 plan goldens, aging only)', () => {
    it('single 30d installment → 30.32', async () => {
      prisma.payment.findMany.mockResolvedValue([makeFullPayment('c1', 30, 1)]);
      const result = await service.calculateProvisions('user-1');
      expect(result.totalProvision).toBeCloseTo(30.32, 2);
    });

    it('{60,30} → 227.37 + 30.32 = 257.69', async () => {
      prisma.payment.findMany.mockResolvedValue([
        makeFullPayment('c1', 60, 1),
        makeFullPayment('c1', 30, 2),
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.totalProvision).toBeCloseTo(257.69, 2);
    });

    it('{90,60,30} → 757.92 + 227.37 + 30.32 = 1,015.61', async () => {
      prisma.payment.findMany.mockResolvedValue([
        makeFullPayment('c1', 90, 1),
        makeFullPayment('c1', 60, 2),
        makeFullPayment('c1', 30, 3),
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.totalProvision).toBeCloseTo(1015.61, 2);
    });

    it('{120,90,60,30} → 1,136.87 + 757.92 + 227.37 + 30.32 = 2,152.48', async () => {
      prisma.payment.findMany.mockResolvedValue([
        makeFullPayment('c1', 120, 1),
        makeFullPayment('c1', 90, 2),
        makeFullPayment('c1', 60, 3),
        makeFullPayment('c1', 30, 4),
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.totalProvision).toBeCloseTo(2152.48, 2);
    });

    it('partial row uses fee-netted outstanding: due 1,515.83 paid 1,000 → outstanding 515.83 → B2 15% → 77.37', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay-partial',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal('1515.83'),
          amountPaid: new Prisma.Decimal('1000.00'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
          status: 'PARTIALLY_PAID',
          dueDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 31-60 bucket
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);
      const result = await service.calculateProvisions('user-1');
      // outstanding = 1,515.83 − 1,000.00 = 515.83 → 515.83 × 0.15 = 77.3745 → 77.37
      expect(result.totalProvision).toBeCloseTo(77.37, 2);
    });
  });

  describe('calculateProvisions — streak floor is DORMANT by default (2026-07-26 semantics)', () => {
    it('no consecutive_missed_bucket_map row configured → NO floor, {60,30} = 257.69 (not 454.74)', async () => {
      // beforeEach already mocks systemConfig.findUnique → null for every key.
      prisma.payment.findMany.mockResolvedValue([
        makeFullPayment('c1', 60, 1),
        makeFullPayment('c1', 30, 2),
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.totalProvision).toBeCloseTo(257.69, 2);
      // No floor configured → the streak query itself is skipped entirely.
      expect(consecutiveMissedMock.getStreaks).not.toHaveBeenCalled();
    });

    it('corrupt consecutive_missed_bucket_map JSON → Sentry captured, still NO floor (257.69)', async () => {
      (Sentry.captureException as jest.Mock).mockClear();
      prisma.systemConfig.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.key === 'consecutive_missed_bucket_map' ? { value: 'not-json{{' } : null,
        ),
      );
      prisma.payment.findMany.mockResolvedValue([
        makeFullPayment('c1', 60, 1),
        makeFullPayment('c1', 30, 2),
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.totalProvision).toBeCloseTo(257.69, 2);
      expect(Sentry.captureException as jest.Mock).toHaveBeenCalled();
    });

    it('empty consecutive_missed_bucket_map ({}) → NO floor (257.69)', async () => {
      prisma.systemConfig.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(where.key === 'consecutive_missed_bucket_map' ? { value: '{}' } : null),
      );
      prisma.payment.findMany.mockResolvedValue([
        makeFullPayment('c1', 60, 1),
        makeFullPayment('c1', 30, 2),
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.totalProvision).toBeCloseTo(257.69, 2);
    });

    it('explicit non-empty config + streak 2 → floor B2 applied per-installment: {60,30} both floored → 227.37×2 = 454.74', async () => {
      prisma.systemConfig.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.key === 'consecutive_missed_bucket_map' ? { value: JSON.stringify({ '2': '31-60' }) } : null,
        ),
      );
      consecutiveMissedMock.getStreaks.mockResolvedValue(new Map([['c1', 2]]));
      prisma.payment.findMany.mockResolvedValue([
        makeFullPayment('c1', 60, 1), // aging 31-60 already
        makeFullPayment('c1', 30, 2), // aging 1-30, floored up to 31-60
      ]);
      const result = await service.calculateProvisions('user-1');
      // both installments provision at 31-60 (15%): 1,515.83 × 0.15 = 227.3745 → 227.37 each
      expect(result.totalProvision).toBeCloseTo(454.74, 2);
    });
  });

  describe('calculateProvisions — TERMINATED contract uses the SAME per-installment aging as ACTIVE (carrying-amount base retired)', () => {
    it('TERMINATED: per-installment math, no carrying-amount override — only 11-2102 queried (delta), never 11-2103/11-2101/11-2106', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay-t1',
          contractId: 'c-t',
          installmentNo: 1,
          amountDue: new Prisma.Decimal('1515.83'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 91-180 bucket (B4 75%)
          contract: { id: 'c-t', ...STD_CONTRACT_FIELDS },
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([]); // 11-2102 GL = 0 for the delta calc

      const result = await service.calculateProvisions('owner-1');

      // 1,515.83 × 0.75 = 1,136.8725 → 1,136.87 — SAME formula an ACTIVE
      // contract at 100 days would get. No carrying-amount override.
      expect(result.totalProvision).toBeCloseTo(1136.87, 2);
      // The retired terminatedCarryingAmount() used to fire 3 EXTRA glBalance
      // queries (11-2103/11-2101/11-2106) before the delta's 11-2102 lookup —
      // only ONE journalLine.findMany call should happen now.
      expect(prisma.journalLine.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ accountCode: '11-2102' }) }),
      );
    });
  });

  describe('calculateProvisions — bucketBreakdown + blended rate + oldest-installment display bucket (spec §2.3)', () => {
    it('persists per-bucket breakdown, agingBucket = bucket of the OLDEST installment, provisionRate = blended', async () => {
      prisma.payment.findMany.mockResolvedValue([
        makeFullPayment('c1', 90, 1), // 61-90, 50%
        makeFullPayment('c1', 30, 2), // 1-30, 2%
      ]);

      await service.calculateProvisions('user-1');

      const created = prisma.badDebtProvision.createMany.mock.calls[0][0].data[0];
      // agingBucket = bucket of the OLDEST installment (90d → 61-90), not a blend
      expect(created.agingBucket).toBe('61-90');
      expect(created.bucketBreakdown['61-90']).toMatchObject({
        count: 1,
        base: '1515.83',
        provision: '757.92',
      });
      expect(created.bucketBreakdown['1-30']).toMatchObject({
        count: 1,
        base: '1515.83',
        provision: '30.32',
      });
      const outstanding = Number(created.outstandingAmount);
      const provisionAmt = Number(created.provisionAmount);
      expect(outstanding).toBeCloseTo(3031.66, 2); // 1,515.83 × 2
      expect(provisionAmt).toBeCloseTo(788.24, 2); // 757.92 + 30.32
      // Blended rate = provision / base — self-consistent, not hardcoded.
      expect(Number(created.provisionRate)).toBeCloseTo(provisionAmt / outstanding, 4);
    });
  });

  describe('calculateProvisions — aggregation and reversal', () => {
    it('aggregates multiple payments per contract by summing outstanding', async () => {
      const baseDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(200),
          lateFee: new Prisma.Decimal(50),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: baseDate,
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
        {
          id: 'p2',
          contractId: 'c1',
          installmentNo: 2,
          amountDue: new Prisma.Decimal(500),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);

      await service.calculateProvisions('user-1');

      const created = prisma.badDebtProvision.createMany.mock.calls[0][0].data;
      expect(created).toHaveLength(1); // one provision per contract (2 installment rows summed)
      // Fee-netted engine (2026-07-26 plan, Task 1): row1 netFee=min(paid=200,
      // lateFee=50)=50 → baseCash=200-50=150 → outstanding=1000-150=850.
      // row2: due=500, paid=0 → outstanding=500. Sum=850+500=1,350
      // (was 1,300 under the old naive due−paid formula that never netted the
      // fee back out of amountPaid).
      // PR #780 Wave 1: outstandingAmount is now persisted as Decimal (not Number cast)
      expect(Number(created[0].outstandingAmount)).toBe(1350);
    });

    it('uses the OLDEST overdue installment for the aging bucket (not the newest)', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days
      const newDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      // payments are returned in dueDate ASC order per the service query
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: oldDate,
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
        {
          id: 'p2',
          contractId: 'c1',
          installmentNo: 2,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: newDate,
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);

      const result = await service.calculateProvisions('user-1');
      // 100 days → 91-180 bucket (NOT 1-30 from the newer payment)
      expect(result.byBucket['91-180']).toBeDefined();
      expect(result.byBucket['1-30']).toBeUndefined();
    });

    it('reverses existing ACTIVE provisions BEFORE creating new ones (idempotency)', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);

      await service.calculateProvisions('user-1');

      // Reversal must have happened
      expect(prisma.badDebtProvision.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          contractId: { in: ['c1'] },
          deletedAt: null,
        },
        data: { status: 'REVERSED' },
      });
    });

    it('does NOT reverse anything when there are no overdue payments in scope', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      await service.calculateProvisions('user-1');
      expect(prisma.badDebtProvision.updateMany).not.toHaveBeenCalled();
      expect(prisma.badDebtProvision.createMany).not.toHaveBeenCalled();
    });

    it('respects branchId filter', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      await service.calculateProvisions('user-1', 'branch-2');
      const where = prisma.payment.findMany.mock.calls[0][0].where;
      expect(where.contract.branchId).toBe('branch-2');
    });

    it('always filters out soft-deleted contracts', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      await service.calculateProvisions('user-1');
      const where = prisma.payment.findMany.mock.calls[0][0].where;
      expect(where.contract.deletedAt).toBeNull();
    });

    it('NEVER includes late fee in the ECL base (waived or not)', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          installmentNo: 1,
          status: 'PENDING',
          contract: { id: 'c-1', ...STD_CONTRACT_FIELDS },
          dueDate: new Date(Date.now() - 40 * 86_400_000), // B2 15%
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('75.79'),
          lateFeeWaived: false, // ยังไม่ waive — เดิมเคยถูกบวกเข้าฐาน
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([]);

      const result = await service.calculateProvisions('owner-1');
      // ฐาน = 1,000.00 เท่านั้น → 15% = 150.00 (ไม่ใช่ 1,075.79 × 15%)
      expect(result.totalProvision).toBe(150.0);
    });

    it('calls BadDebtProvisionTemplate.execute with correct delta vs prior provision (Phase A.5a)', async () => {
      // Prior GL 11-2102 balance for c1: 50 (2%) — sourced from journal lines, not BadDebtProvision rows
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('50') },
      ]);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          // 31 days ago → 31-60 bucket (B2) → 15% → provisionAmount = 150 (CPA ECL v3.0)
          dueDate: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);

      await service.calculateProvisions('user-1');

      expect(provisionTemplateMock.execute).toHaveBeenCalledTimes(1);
      const callArgs = provisionTemplateMock.execute.mock.calls[0][0];
      expect(callArgs.contractId).toBe('c1');
      // new = 150 (B2 15%), prev (GL) = 50, provisionAmount (delta) = 100
      expect(Number(callArgs.provisionAmount)).toBeCloseTo(100, 4);
      expect(callArgs.period).toMatch(/^\d{4}-\d{2}$/);
    });

    it('skips BadDebtProvisionTemplate.execute when delta is zero (no change in provision)', async () => {
      // Prior GL 11-2102 balance = same as new target provision (1000 * 0.02 = 20)
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('20') },
      ]);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          // 30 days ago → 1-30 bucket → 2% → provisionAmount = 20 (same as prior)
          dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);

      await service.calculateProvisions('user-1');

      expect(provisionTemplateMock.execute).not.toHaveBeenCalled();
    });

    it('computes delta against GL 11-2102 balance (not BadDebtProvision rows)', async () => {
      // 1 contract, 40 วัน overdue, outstanding 1,000 → B2 15% → target 150.00
      prisma.payment.findMany.mockResolvedValue([
        {
          installmentNo: 1,
          status: 'PENDING',
          contract: { id: 'c-1', ...STD_CONTRACT_FIELDS },
          dueDate: new Date(Date.now() - 40 * 86_400_000),
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
        },
      ]);
      // DB rows บอก prev = 150 (JE เดิมเคย fail) แต่ GL มีจริงแค่ 100
      prisma.badDebtProvision.findMany.mockResolvedValue([
        { contractId: 'c-1', provisionAmount: new Prisma.Decimal('150.00') },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('100.00') },
      ]);

      await service.calculateProvisions('owner-1');

      // delta ต้อง = 150 − 100(GL) = 50 ไม่ใช่ 150 − 150(DB) = 0
      expect(provisionTemplateMock.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'c-1',
          provisionAmount: expect.decimalEq('50.00'),
        }),
      );
    });

    it('posts negative delta (release) when GL balance exceeds new target', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          installmentNo: 1,
          status: 'PENDING',
          contract: { id: 'c-1', ...STD_CONTRACT_FIELDS },
          dueDate: new Date(Date.now() - 10 * 86_400_000), // B1 2%
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('150.00') },
      ]);

      await service.calculateProvisions('owner-1');
      // target = 20.00 (2%), GL = 150 → delta = −130.00
      expect(provisionTemplateMock.execute).toHaveBeenCalledWith(
        expect.objectContaining({ provisionAmount: expect.decimalEq('-130.00') }),
      );
    });

    it('CRITICAL fix: a zero-outstanding contract (engine dropped all rows) still gets a GL-based release JE', async () => {
      // installment fully fee-netted to 0 outstanding (due 1,515.83, paid
      // 1,515.83 + 50 fee) — status hasn't flipped to PAID yet (PARTIALLY_PAID),
      // so the top-level query still returns it, but computeInstallmentOutstanding
      // drops the row (outstanding <= 0) → contractGroups has this contract, but
      // `provisions` never gets an entry for it. Before the fix, the delta/GL
      // loop iterated `provisions` only, so this contract's stale GL 11-2102
      // balance (100) was NEVER re-evaluated/released — a silent DB-vs-GL
      // divergence. The loop must iterate contractIdsInScope instead, treating
      // the missing entry as target = 0.
      prisma.payment.findMany.mockResolvedValue([
        {
          installmentNo: 1,
          status: 'PARTIALLY_PAID',
          contract: { id: 'c-1', ...STD_CONTRACT_FIELDS },
          dueDate: new Date(Date.now() - 40 * 86_400_000),
          amountDue: new Prisma.Decimal('1515.83'),
          amountPaid: new Prisma.Decimal('1565.83'), // 1,515.83 principal + 50 fee
          lateFee: new Prisma.Decimal('50.00'),
          lateFeeWaived: false,
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('100.00') },
      ]);

      const result = await service.calculateProvisions('owner-1');

      // No provision row created for this contract (engine saw 0 outstanding).
      expect(prisma.badDebtProvision.createMany).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
      // ...but the GL release JE still fires: target 0 − GL 100 = −100.00.
      expect(provisionTemplateMock.execute).toHaveBeenCalledWith(
        expect.objectContaining({ contractId: 'c-1', provisionAmount: expect.decimalEq('-100.00') }),
      );
    });

    it('dryRun: zero-outstanding contract still appears in deltas with target 0.00', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          installmentNo: 1,
          status: 'PARTIALLY_PAID',
          contract: { id: 'c-1', ...STD_CONTRACT_FIELDS },
          dueDate: new Date(Date.now() - 40 * 86_400_000),
          amountDue: new Prisma.Decimal('1515.83'),
          amountPaid: new Prisma.Decimal('1565.83'),
          lateFee: new Prisma.Decimal('50.00'),
          lateFeeWaived: false,
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('100.00') },
      ]);

      const result = await service.calculateProvisions('owner-1', undefined, true);

      expect(result.deltas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contractId: 'c-1',
            target: '0.00',
            prevGl: '100.00',
            delta: '-100.00',
          }),
        ]),
      );
      // dryRun never writes rows.
      expect(prisma.badDebtProvision.createMany).not.toHaveBeenCalled();
    });
  });

  describe('calculateProvisions — dryRun (Task 8)', () => {
    it('dryRun=true computes deltas but writes nothing', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          installmentNo: 1,
          status: 'PENDING',
          contract: { id: 'c-1', ...STD_CONTRACT_FIELDS },
          dueDate: new Date(Date.now() - 40 * 86_400_000),
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([]);

      const r = await service.calculateProvisions('owner-1', undefined, true);
      expect(r.deltas).toHaveLength(1);
      expect(r.deltas![0].delta).toBe('150.00');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(provisionTemplateMock.execute).not.toHaveBeenCalled();
    });
  });

  describe('calculateProvisions — config rates', () => {
    it('falls back to defaults when systemConfig is missing', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['1-30'].amount).toBeCloseTo(20, 4); // default 0.02
    });

    it('uses custom rates from systemConfig when present', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        value: JSON.stringify({ '1-30': 0.05 }),
      });
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['1-30'].amount).toBeCloseTo(50, 4); // custom 0.05
    });

    it('merges stale/partial rate config over defaults instead of zeroing missing buckets', async () => {
      (Sentry.captureMessage as jest.Mock).mockClear();
      // Stale shape from an old seed — canonical B4/B5 keys renamed from
      // 181-360/360+ to 91-180/180+ and never migrated in this config row.
      prisma.systemConfig.findUnique.mockResolvedValue({
        value: JSON.stringify({
          '1-30': 0.02,
          '31-60': 0.15,
          '61-90': 0.5,
          '181-360': 0.75,
          '360+': 1.0,
        }),
      });
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // B4 (91-180)
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);
      const result = await service.calculateProvisions('user-1');
      // Without the merge, rates['91-180'] || 0 would silently provision 0.
      expect(result.byBucket['91-180'].amount).toBeCloseTo(750, 4); // merged default 0.75
      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalled();
    });

    it('falls back to defaults when systemConfig has malformed JSON', async () => {
      (Sentry.captureException as jest.Mock).mockClear();
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 'not-json{{' });
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          status: 'PENDING',
          dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          contract: { id: 'c1', ...STD_CONTRACT_FIELDS },
        },
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['1-30'].amount).toBeCloseTo(20, 4); // back to defaults
      // ...but the corrupt regulated-rate config is NOT silently swallowed.
      expect(Sentry.captureException as jest.Mock).toHaveBeenCalled();
    });
  });

  describe('writeOffBadDebt — segregation of duties + T3-C6 tiers', () => {
    it('refuses when writer and approver are the same person', async () => {
      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'bm-1', 'reason'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when contract is missing', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await expect(
        service.writeOffBadDebt('missing', 'bm-1', 'fm-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to write off an already CLOSED_BAD_DEBT contract', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'CLOSED_BAD_DEBT' });
      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'fm-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses write-off when contract is not TERMINATED (Excel v3 workflow gate)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c-1', status: 'OVERDUE', contractNumber: 'CT-1' });
      await expect(
        service.writeOffBadDebt('c-1', 'fm-1', 'owner-1'),
      ).rejects.toThrow('ตัดหนี้สูญได้เฉพาะสัญญาที่บอกเลิกแล้ว');
    });

    it('allows write-off when contract is TERMINATED', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c-1', status: 'TERMINATED', contractNumber: 'CT-1' });
      prisma.payment.findMany.mockResolvedValue([]);
      await expect(service.writeOffBadDebt('c-1', 'fm-1', 'owner-1')).resolves.toBeDefined();
    });

    it('marks contract CLOSED_BAD_DEBT and active provisions WRITTEN_OFF', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.contract.update.mockResolvedValue({});
      prisma.badDebtProvision.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.writeOffBadDebt('c1', 'bm-1', 'fm-1', 'court order');

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'CLOSED_BAD_DEBT' },
      });
      expect(prisma.badDebtProvision.updateMany).toHaveBeenCalledWith({
        where: { contractId: 'c1', status: 'ACTIVE', deletedAt: null },
        data: expect.objectContaining({
          status: 'WRITTEN_OFF',
          writtenOffById: 'bm-1',
          approvedById: 'fm-1',
          notes: 'court order',
        }),
      });
      expect(result.status).toBe('CLOSED_BAD_DEBT');
    });

    it('issues CN inside the same tx as the write-off JE, with source=WRITE_OFF and the entryNo the template returned', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.contract.update.mockResolvedValue({});
      prisma.badDebtProvision.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.writeOffBadDebt('c1', 'bm-1', 'fm-1', 'court order');

      expect(creditNoteService.issueForContract).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'c1',
          source: 'WRITE_OFF',
          sourceJournalEntryNo: 'JE-MOCK',
          actorUserId: 'bm-1',
        }),
        prisma, // same tx the write-off JE was posted in — atomic
      );
      expect(result.creditNote).toEqual({ outcome: 'ISSUED', receiptId: 'r1' });
    });

    it('rolls back the whole write-off when CN issuance throws (atomicity)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.contract.update.mockResolvedValue({});
      prisma.badDebtProvision.updateMany.mockResolvedValue({ count: 1 });
      creditNoteService.issueForContract.mockRejectedValueOnce(new Error('CN fail'));

      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'fm-1', 'court order'),
      ).rejects.toThrow('CN fail');
      expect(creditNoteService.issueForContract).toHaveBeenCalled();
    });

    // Phase 3 Task 5 — post-commit LINE delivery hook.
    describe('CreditNoteDeliveryService post-commit hook', () => {
      it('fires deliver(receiptId) AFTER the $transaction resolves, with the ISSUED receiptId', async () => {
        prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
        prisma.contract.update.mockResolvedValue({});
        prisma.badDebtProvision.updateMany.mockResolvedValue({ count: 1 });

        await service.writeOffBadDebt('c1', 'bm-1', 'fm-1', 'court order');

        expect(cnDeliveryServiceMock.deliver).toHaveBeenCalledWith('r1');
        // Ordering proof: deliver's global invocation index must come AFTER
        // $transaction's — i.e. the hook runs post-commit, never from inside
        // the transaction callback.
        const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
        const deliverOrder = cnDeliveryServiceMock.deliver.mock.invocationCallOrder[0];
        expect(deliverOrder).toBeGreaterThan(txOrder);
      });

      it('does NOT call deliver when the CN outcome is SKIPPED (no accrued / duplicate)', async () => {
        prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
        prisma.contract.update.mockResolvedValue({});
        prisma.badDebtProvision.updateMany.mockResolvedValue({ count: 1 });
        creditNoteService.issueForContract.mockResolvedValueOnce({ outcome: 'SKIPPED_NO_ACCRUED' });

        await service.writeOffBadDebt('c1', 'bm-1', 'fm-1', 'court order');

        expect(cnDeliveryServiceMock.deliver).not.toHaveBeenCalled();
      });

      it('resolves normally (no unhandled rejection) even when deliver() itself rejects — fire-and-forget .catch() works', async () => {
        (Sentry.captureException as jest.Mock).mockClear();
        prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
        prisma.contract.update.mockResolvedValue({});
        prisma.badDebtProvision.updateMany.mockResolvedValue({ count: 1 });
        cnDeliveryServiceMock.deliver.mockRejectedValueOnce(new Error('deliver boom'));

        // writeOffBadDebt must resolve normally — deliver() is fire-and-forget
        // (`void ... .catch(Sentry.captureException)`), never awaited, so its
        // rejection must never propagate to the caller.
        await expect(
          service.writeOffBadDebt('c1', 'bm-1', 'fm-1', 'court order'),
        ).resolves.toMatchObject({ status: 'CLOSED_BAD_DEBT' });

        // Flush the fire-and-forget microtask so the .catch() handler has run
        // before asserting — proves the rejection was actually caught
        // (Sentry.captureException), not merely swallowed by timing luck.
        await new Promise((resolve) => setImmediate(resolve));
        expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
      });
    });

    // T3-C6 tier tests. The outstandingAmount is driven by what
    // prisma.payment.findMany returns inside the transaction.
    const mkUnpaid = (amountDue: number) => [{
      id: 'p1',
      contractId: 'c1',
      installmentNo: 1,
      amountDue: new Prisma.Decimal(amountDue),
      amountPaid: new Prisma.Decimal(0),
      lateFee: new Prisma.Decimal(0),
      lateFeeWaived: false,
    }];

    it('tier 1 (≤10k): BM writer + ACCT approver is rejected (ACCT not in BM/FM/OWNER allowed list)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(5000));

      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'acct-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('tier 2 (10-30k): BM approver rejected — must be FM or OWNER', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(20000));

      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'bm-2'),
      ).rejects.toThrow(/FINANCE_MANAGER|OWNER/);
    });

    it('tier 2 (10-30k): FM approver accepted', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(20000));
      prisma.contract.update.mockResolvedValue({});

      const result = await service.writeOffBadDebt('c1', 'bm-1', 'fm-1');
      expect(result.status).toBe('CLOSED_BAD_DEBT');
    });

    it('tier 3 (>30k): non-OWNER approver rejected', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(50000));

      await expect(
        service.writeOffBadDebt('c1', 'fm-1', 'fm-2'),
      ).rejects.toThrow(/OWNER/);
    });

    it('tier 3 (>30k): BM writer rejected (must be FM or OWNER)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(50000));

      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'owner-1'),
      ).rejects.toThrow(/FINANCE_MANAGER/);
    });

    it('tier 3 (>30k): FM writer + OWNER approver accepted', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(50000));
      prisma.contract.update.mockResolvedValue({});

      const result = await service.writeOffBadDebt('c1', 'fm-1', 'owner-1');
      expect(result.status).toBe('CLOSED_BAD_DEBT');
    });

    it('rejects when approver account is deactivated', async () => {
      prisma.user.findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve({
          id,
          role: id.startsWith('fm') ? 'FINANCE_MANAGER' : 'BRANCH_MANAGER',
          isActive: id !== 'fm-1', // fm-1 is deactivated
          deletedAt: null,
        }),
      );
      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'fm-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // ── T1-C7: immutable write-off audit log ─────────────────────────────
    describe('T1-C7: BadDebtWriteOffAuditLog', () => {
      beforeEach(() => {
        prisma.contract.findFirst.mockResolvedValue({
          id: 'c1',
          contractNumber: 'HP-001',
          status: 'TERMINATED',
        });
        prisma.contract.update.mockResolvedValue({});
        prisma.badDebtProvision.updateMany.mockResolvedValue({ count: 1 });
        prisma.badDebtProvision.findMany.mockResolvedValue([]);
        prisma.payment.findMany.mockResolvedValue(mkUnpaid(15_000));
      });

      it('writes an audit log row inside the same transaction as the write-off', async () => {
        await service.writeOffBadDebt('c1', 'bm-1', 'fm-1', 'court order');
        expect(prisma.badDebtWriteOffAuditLog.create).toHaveBeenCalledTimes(1);
      });

      it('snapshots contractNumber + writer/approver IDs + roles at write-off time', async () => {
        await service.writeOffBadDebt('c1', 'bm-1', 'fm-1', 'court order');
        const data = prisma.badDebtWriteOffAuditLog.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
          contractId: 'c1',
          contractNumber: 'HP-001',
          writtenOffById: 'bm-1',
          writtenOffByRole: 'BRANCH_MANAGER',
          approvedById: 'fm-1',
          approvedByRole: 'FINANCE_MANAGER',
          notes: 'court order',
        });
      });

      it('records outstandingAmount computed from unpaid payments', async () => {
        prisma.payment.findMany.mockResolvedValue(mkUnpaid(25_000));
        await service.writeOffBadDebt('c1', 'bm-1', 'fm-1');
        const data = prisma.badDebtWriteOffAuditLog.create.mock.calls[0][0].data;
        expect(Number(data.outstandingAmount)).toBe(25_000);
      });

      it('records provisionAmount from GL 11-2102 balance (not DB rows)', async () => {
        // DB rows say 1,000.00 (would be wrong if a past provision JE ever
        // failed silently) but the real GL 11-2102 balance is only 800.00 —
        // the audit log must report what the JE actually consumed (GL wins).
        prisma.badDebtProvision.findMany.mockResolvedValue([
          { provisionAmount: new Prisma.Decimal(1_000) },
        ]);
        prisma.journalLine.findMany.mockResolvedValue([
          { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('500.00') },
          { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('300.00') },
        ]);
        await service.writeOffBadDebt('c1', 'bm-1', 'fm-1');
        const data = prisma.badDebtWriteOffAuditLog.create.mock.calls[0][0].data;
        expect(Number(data.provisionAmount)).toBe(800);
      });

      it('does not write audit log if tier rule rejects the write-off', async () => {
        // 25k outstanding with BM-only approver → tier rule fails (needs FM+)
        prisma.payment.findMany.mockResolvedValue(mkUnpaid(25_000));
        await expect(
          service.writeOffBadDebt('c1', 'bm-1', 'bm-2'),
        ).rejects.toBeDefined();
        expect(prisma.badDebtWriteOffAuditLog.create).not.toHaveBeenCalled();
      });

      it('does not write audit log if contract is already CLOSED_BAD_DEBT', async () => {
        prisma.contract.findFirst.mockResolvedValue({
          id: 'c1',
          contractNumber: 'HP-001',
          status: 'CLOSED_BAD_DEBT',
        });
        await expect(
          service.writeOffBadDebt('c1', 'bm-1', 'fm-1'),
        ).rejects.toBeDefined();
        expect(prisma.badDebtWriteOffAuditLog.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('getProvisionSummary', () => {
    it('filters out soft-deleted and non-ACTIVE provisions', async () => {
      prisma.badDebtProvision.findMany.mockResolvedValue([]);
      await service.getProvisionSummary();
      const where = prisma.badDebtProvision.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('ACTIVE');
      expect(where.deletedAt).toBeNull();
    });

    it('aggregates outstanding and provision totals across buckets', async () => {
      prisma.badDebtProvision.findMany.mockResolvedValue([
        {
          contractId: 'c1',
          contract: { contractNumber: 'CNT-001', customerId: 'cu1', customer: { name: 'A' } },
          agingBucket: '1-30',
          daysOverdue: 15,
          outstandingAmount: new Prisma.Decimal(1000),
          provisionRate: new Prisma.Decimal(0.02),
          provisionAmount: new Prisma.Decimal(20),
        },
        {
          contractId: 'c2',
          contract: { contractNumber: 'CNT-002', customerId: 'cu2', customer: { name: 'B' } },
          agingBucket: '31-60',
          daysOverdue: 45,
          outstandingAmount: new Prisma.Decimal(2000),
          provisionRate: new Prisma.Decimal(0.10),
          provisionAmount: new Prisma.Decimal(200),
        },
      ]);

      const summary = await service.getProvisionSummary();

      expect(summary.totalOutstanding).toBe(3000);
      expect(summary.totalProvision).toBe(220);
      expect(summary.byBucket['1-30'].count).toBe(1);
      expect(summary.byBucket['31-60'].count).toBe(1);
      expect(summary.details).toHaveLength(2);
    });
  });

  describe('reverseStageOnPayment — per-installment engine, TERMINATED unified (2026-07-26 Task 4)', () => {
    beforeEach(() => {
      // Every scenario below drives computeInstallmentOutstanding, which needs
      // the contract's financial fields (installmentTotal derives from these)
      // — default to the standard 17k/12m fixture (installmentTotal 1,515.83)
      // unless a test overrides it.
      prisma.contract.findUnique.mockResolvedValue({ id: 'ct-1', ...STD_CONTRACT_FIELDS });
    });

    function setActiveProvision(opts: { provisionAmount: number; agingBucket: string }) {
      prisma.badDebtProvision.findFirst.mockResolvedValue({
        id: 'prov-1',
        contractId: 'ct-1',
        agingBucket: opts.agingBucket,
        daysOverdue: 45,
        outstandingAmount: new Prisma.Decimal(2000),
        provisionRate: new Prisma.Decimal(0.15),
        provisionAmount: new Prisma.Decimal(opts.provisionAmount),
        status: 'ACTIVE',
      });
    }

    // Payment rows the engine's DUE query will client-side re-filter on
    // `status`/`dueDate` — must carry a DUE status (PENDING here) or the
    // engine drops them, unlike the pre-engine code which trusted the outer
    // query's where-clause unconditionally.
    function setOverduePayments(rows: Array<{ daysAgo: number; due: number; paid?: number }>) {
      const now = Date.now();
      prisma.payment.findMany.mockResolvedValue(
        rows.map((r, i) => ({
          id: `p-${i}`,
          installmentNo: i + 1,
          status: 'PENDING',
          dueDate: new Date(now - r.daysAgo * 24 * 60 * 60 * 1000),
          amountDue: new Prisma.Decimal(r.due.toFixed(2)),
          amountPaid: new Prisma.Decimal((r.paid ?? 0).toFixed(2)),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
        })),
      );
    }

    it('returns null when no ACTIVE provision exists for the contract', async () => {
      prisma.badDebtProvision.findFirst.mockResolvedValue(null);
      const result = await service.reverseStageOnPayment('ct-1');
      expect(result).toBeNull();
    });

    it('returns null when the target did not drop (aging bucket unchanged)', async () => {
      // 35d overdue, full installment → 31-60 bucket → 227.37 — same as the
      // persisted provision, so there is nothing to release.
      setActiveProvision({ provisionAmount: 227.37, agingBucket: '31-60' });
      setOverduePayments([{ daysAgo: 35, due: INSTALLMENT_TOTAL }]);
      const result = await service.reverseStageOnPayment('ct-1');
      expect(result).toBeNull();
    });

    it('pays off the oldest installment → target drops → releases the diff (GL-capped)', async () => {
      // Provision was set when 2 installments were overdue: 91d @ 75% =
      // 1,136.87 + 61d @ 50% = 757.92 → 1,894.79. The 91-day installment just
      // got paid off (excluded from the DUE query) — only the 61-day one
      // remains, so the new target is just its own provision.
      setActiveProvision({ provisionAmount: 1894.79, agingBucket: '91-180' });
      setOverduePayments([{ daysAgo: 61, due: INSTALLMENT_TOTAL }]);
      // GL 11-2102 holds the full original provision — ample room, not clipped.
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('1894.79') },
      ]);

      const result = await service.reverseStageOnPayment('ct-1');

      expect(result).not.toBeNull();
      expect(result!.fromBucket).toBe('91-180');
      expect(result!.toBucket).toBe('61-90');
      expect(result!.reverseAmount).toBe('1136.87');

      const updateCall = prisma.badDebtProvision.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('prov-1');
      expect(updateCall.data.agingBucket).toBe('61-90');
      expect(updateCall.data.provisionAmount.toString()).toBe('757.92');
      expect(updateCall.data.bucketBreakdown['61-90']).toEqual({
        count: 1,
        base: '1515.83',
        provision: '757.92',
      });
    });

    it('reverses the entire provision and marks REVERSED when no outstanding installments remain', async () => {
      setActiveProvision({ provisionAmount: 300, agingBucket: '31-60' });
      prisma.payment.findMany.mockResolvedValue([]); // fully current / fully paid off
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('300') },
      ]);

      const result = await service.reverseStageOnPayment('ct-1');

      expect(result).not.toBeNull();
      expect(result!.toBucket).toBe('CURRENT');
      expect(result!.reverseAmount).toBe('300.00');

      const updateCall = prisma.badDebtProvision.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('REVERSED');
    });

    it('concurrent payments on the same contract: each reads its own snapshot, updates atomically', async () => {
      // Two payments race on the same contract within the same serializable
      // tx isolation in payments.service.ts. At the service layer, both calls
      // see the ACTIVE provision and post their own reverse — but in
      // production the outer serializable tx will retry one of them, so each
      // call must be self-consistent on its own snapshot.
      setActiveProvision({ provisionAmount: 1894.79, agingBucket: '91-180' });
      setOverduePayments([{ daysAgo: 61, due: INSTALLMENT_TOTAL }]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('1894.79') },
      ]);

      const [r1, r2] = await Promise.all([
        service.reverseStageOnPayment('ct-1'),
        service.reverseStageOnPayment('ct-1'),
      ]);

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1!.reverseAmount).toBe(r2!.reverseAmount);
      expect(r1!.fromBucket).toBe(r2!.fromBucket);
      expect(r1!.toBucket).toBe(r2!.toBucket);

      // Both calls saw the same provision row + same overdue snapshot, so
      // both posted reverses. Production safety: outer serializable tx will
      // 40001-retry one of them, ensuring the final state has at most one
      // reverse JE per provision row.
      expect(prisma.badDebtProvision.update).toHaveBeenCalledTimes(2);
    });

    it('custom bad_debt_provision_rates SystemConfig flows through the target calc', async () => {
      prisma.systemConfig.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.key === 'bad_debt_provision_rates'
            ? {
                value: JSON.stringify({
                  '1-30': 0.02,
                  '31-60': 0.15,
                  '61-90': 0.1, // custom — was 0.50
                  '91-180': 0.75,
                  '180+': 1.0,
                }),
              }
            : null,
        ),
      );
      // Provision was set under the OLD 50% rate (757.92); rates just changed
      // to 10% for 61-90 → new target = 1,515.83 × 0.10 = 151.58.
      setActiveProvision({ provisionAmount: 757.92, agingBucket: '61-90' });
      setOverduePayments([{ daysAgo: 61, due: INSTALLMENT_TOTAL }]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('757.92') },
      ]);

      const result = await service.reverseStageOnPayment('ct-1');
      expect(result).not.toBeNull();
      expect(result!.reverseAmount).toBe('606.34'); // 757.92 − 151.58
      expect(result!.toBucket).toBe('61-90');
    });

    it('excludes future (not-yet-due) installments from the base', async () => {
      setActiveProvision({ provisionAmount: 150, agingBucket: '31-60' });
      // 1 งวดค้าง 10 วัน (1,000) — งวดอนาคตถูกกรองที่ query แล้ว จึงไม่อยู่ใน mock นี้
      setOverduePayments([{ daysAgo: 10, due: 1000 }]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('150.00') },
      ]);

      const r = await service.reverseStageOnPayment('ct-1');
      // bucket ใหม่ B1 2% × 1,000 = 20 → reverse = 150 − 20 = 130
      expect(r!.reverseAmount).toBe('130.00');
      // และ query ต้องส่ง dueDate filter
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dueDate: expect.objectContaining({ lt: expect.any(Date) }) }),
        }),
      );
    });

    describe('I1 — cap release at live GL balance', () => {
      it('full-reverse: row=150 but GL=0 → EclStageReverseTemplate NOT called, row still marked REVERSED', async () => {
        setActiveProvision({ provisionAmount: 150, agingBucket: '31-60' });
        // Fully current — no overdue payments — would take the full-reverse path.
        prisma.payment.findMany.mockResolvedValue([]);
        // GL 11-2102 actually holds 0 — the provision row overstates reality
        // (e.g. a past provision JE failed silently before idempotency hardening).
        prisma.journalLine.findMany.mockResolvedValue([]);

        const result = await service.reverseStageOnPayment('ct-1');

        expect(result).toBeNull();
        expect(eclStageReverseTemplateMock.execute).not.toHaveBeenCalled();
        const updateCall = prisma.badDebtProvision.update.mock.calls[0][0];
        expect(updateCall.where.id).toBe('prov-1');
        expect(updateCall.data.status).toBe('REVERSED');
      });

      it('stage-drop: row-delta=130 but GL=100 → template called with reverseAmount 100.00', async () => {
        // Existing 150; new aging 15 days on 1,000 due → B1 2% = 20.
        // Row-based delta = 150 − 20 = 130, but GL only holds 100.
        setActiveProvision({ provisionAmount: 150, agingBucket: '31-60' });
        setOverduePayments([{ daysAgo: 15, due: 1000 }]);
        prisma.journalLine.findMany.mockResolvedValue([
          { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('100') },
        ]);

        const result = await service.reverseStageOnPayment('ct-1');

        expect(result).not.toBeNull();
        expect(result!.reverseAmount).toBe('100.00');
        expect(eclStageReverseTemplateMock.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            contractId: 'ct-1',
            reverseAmount: expect.decimalEq('100.00'),
            fromBucket: '31-60',
            toBucket: '1-30',
          }),
          undefined,
        );
        // Row still moves to the new bucket/amount even though the JE amount was clipped.
        const updateCall = prisma.badDebtProvision.update.mock.calls[0][0];
        expect(updateCall.data.agingBucket).toBe('1-30');
        expect(updateCall.data.provisionAmount.toString()).toBe('20');
      });
    });

    describe('TERMINATED contract — carrying-amount machinery retired, flows the SAME per-installment path', () => {
      it('never queries 11-2103/11-2101/11-2106 — only 11-2102 (I1 cap) — and no longer even selects contract.status', async () => {
        // The retired terminatedCarryingAmount() fired 3 EXTRA glBalance
        // queries (11-2103/11-2101/11-2106) before ever reaching the 11-2102
        // cap check, gated on a `contract.status === 'TERMINATED'` lookup.
        // That machinery is gone — a TERMINATED contract is now
        // indistinguishable in code from an ACTIVE one.
        setActiveProvision({ provisionAmount: 1894.79, agingBucket: '91-180' });
        setOverduePayments([{ daysAgo: 61, due: INSTALLMENT_TOTAL }]);
        prisma.journalLine.findMany.mockResolvedValue([
          { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('1894.79') },
        ]);

        const result = await service.reverseStageOnPayment('ct-1');

        expect(result).not.toBeNull();
        expect(result!.toBucket).toBe('61-90');
        expect(result!.reverseAmount).toBe('1136.87');

        const queriedAccountCodes = prisma.journalLine.findMany.mock.calls.map(
          (call: any) => call[0].where.accountCode,
        );
        expect(queriedAccountCodes.every((code: string) => code === '11-2102')).toBe(true);
        expect(prisma.contract.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'ct-1' } }),
        );
        expect(prisma.contract.findUnique.mock.calls[0][0].select.status).toBeUndefined();
      });

      it('full carrying settled (all installments paid off) → full reverse via the same path, no special-casing', async () => {
        setActiveProvision({ provisionAmount: 9598.13, agingBucket: '91-180' });
        prisma.payment.findMany.mockResolvedValue([]); // all overdue installments paid off
        prisma.journalLine.findMany.mockResolvedValue([
          { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('9598.13') },
        ]);

        const result = await service.reverseStageOnPayment('ct-1');

        expect(result).not.toBeNull();
        expect(result!.toBucket).toBe('CURRENT');
        expect(result!.reverseAmount).toBe('9598.13');
        // Only the 11-2102 cap check inside fullReverseProvision — no
        // carrying-amount legs queried first.
        expect(prisma.journalLine.findMany).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('OVERDUE payment status in ECL base (2026-07-24 hotfix)', () => {
    // Prod's overdue-lifecycle cron flips past-due payments PENDING → OVERDUE.
    // Excluding OVERDUE made ECL blind to every aged installment on prod.
    const expectedStatusFilter = { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] };

    it('calculateProvisions queries payments with OVERDUE included', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      await service.calculateProvisions('owner-1');
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: expectedStatusFilter }),
        }),
      );
    });

    it('reverseStageOnPayment queries payments with OVERDUE included', async () => {
      prisma.badDebtProvision.findFirst.mockResolvedValue({
        id: 'prov-x',
        contractId: 'ct-x',
        agingBucket: '31-60',
        provisionRate: new Prisma.Decimal('0.15'),
        provisionAmount: new Prisma.Decimal('150.00'),
      });
      prisma.contract.findUnique.mockResolvedValue({ id: 'ct-x', ...STD_CONTRACT_FIELDS });
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.journalLine.findMany.mockResolvedValue([]);

      await service.reverseStageOnPayment('ct-x');

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: expectedStatusFilter }),
        }),
      );
    });

    it('writeOffBadDebt sums outstanding with OVERDUE included', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        id: 'ct-w',
        status: 'TERMINATED',
        contractNumber: 'CT-W',
      });
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.journalLine.findMany.mockResolvedValue([]);

      await service.writeOffBadDebt('ct-w', 'fm-1', 'owner-1');

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: expectedStatusFilter }),
        }),
      );
    });
  });
});
