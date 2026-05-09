import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BadDebtService } from './bad-debt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { BadDebtProvisionTemplate } from '../journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';

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

  beforeEach(async () => {
    prisma = {
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null), // use defaults
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: {
        findFirst: jest.fn(),
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
        { provide: BadDebtProvisionTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
        { provide: BadDebtWriteOffTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
        { provide: EclStageReverseTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-ECL-MOCK' }) } },
      ],
    }).compile();

    service = module.get<BadDebtService>(BadDebtService);
  });

  describe('calculateProvisions — aging bucket boundaries', () => {
    // Helper to build a payment row with a specific dueDate offset (days ago)
    const makePayment = (contractId: string, daysAgo: number, amountDue: number) => ({
      id: `pay-${contractId}-${daysAgo}`,
      contractId,
      installmentNo: 1,
      amountDue: new Prisma.Decimal(amountDue),
      amountPaid: new Prisma.Decimal(0),
      lateFee: new Prisma.Decimal(0),
      lateFeeWaived: false,
      status: 'PENDING',
      dueDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      contract: { id: contractId, status: 'OVERDUE' },
    });

    it('places a 30-day overdue payment in the 1-30 bucket (boundary inclusive)', async () => {
      prisma.payment.findMany.mockResolvedValue([makePayment('c1', 30, 1000)]);

      const result = await service.calculateProvisions('user-1');

      expect(result.created).toBe(1);
      expect(result.byBucket['1-30']).toBeDefined();
      // 1000 * 0.02 (default rate) = 20
      expect(result.byBucket['1-30'].amount).toBeCloseTo(20, 4);
    });

    it('places a 31-day overdue payment in the 31-60 bucket (boundary, B2)', async () => {
      prisma.payment.findMany.mockResolvedValue([makePayment('c1', 31, 1000)]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['31-60'].amount).toBeCloseTo(150, 4); // 1000 * 0.15 (CPA ECL v3.0)
    });

    it('places a 61-day overdue payment in the 61-90 bucket (B3 → terminate)', async () => {
      prisma.payment.findMany.mockResolvedValue([makePayment('c1', 61, 1000)]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['61-90'].amount).toBeCloseTo(500, 4); // 1000 * 0.50 (CPA ECL v3.0)
    });

    it('places a 91-day overdue payment in the 91-180 bucket (B4)', async () => {
      prisma.payment.findMany.mockResolvedValue([makePayment('c1', 91, 1000)]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['91-180'].amount).toBeCloseTo(750, 4); // 1000 * 0.75 (CPA ECL v3.0)
    });

    it('places a 181-day overdue payment in the 180+ bucket (B5 NPL)', async () => {
      prisma.payment.findMany.mockResolvedValue([makePayment('c1', 181, 1000)]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['180+'].amount).toBeCloseTo(1000, 4); // 1000 * 1.00 (CPA B5 NPL)
    });

    it('places a 361-day overdue payment in the 180+ bucket (still B5)', async () => {
      prisma.payment.findMany.mockResolvedValue([makePayment('c1', 361, 1000)]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['180+'].amount).toBeCloseTo(1000, 4); // CPA collapses 180+ into single bucket
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
          contract: { id: 'c1', status: 'OVERDUE' },
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
          contract: { id: 'c1', status: 'OVERDUE' },
        },
      ]);

      await service.calculateProvisions('user-1');

      const created = prisma.badDebtProvision.createMany.mock.calls[0][0].data;
      expect(created).toHaveLength(1); // one provision per contract
      // outstanding = (1000 - 200 + 50) + (500 - 0 + 0) = 850 + 500 = 1350
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
          contract: { id: 'c1', status: 'OVERDUE' },
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
          contract: { id: 'c1', status: 'OVERDUE' },
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
          contract: { id: 'c1', status: 'OVERDUE' },
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

    it('skips lateFee when it is waived', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          contractId: 'c1',
          installmentNo: 1,
          amountDue: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(500), // would be added if not waived
          lateFeeWaived: true,
          status: 'PENDING',
          dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          contract: { id: 'c1', status: 'OVERDUE' },
        },
      ]);

      await service.calculateProvisions('user-1');
      const created = prisma.badDebtProvision.createMany.mock.calls[0][0].data;
      // outstanding = 1000 - 0 + 0 (waived) = 1000
      expect(Number(created[0].outstandingAmount)).toBe(1000);
    });

    it('calls BadDebtProvisionTemplate.execute with correct delta vs prior provision (Phase A.5a)', async () => {
      // Prior ACTIVE provision for c1: 50 (2%)
      prisma.badDebtProvision.findMany.mockResolvedValue([
        { contractId: 'c1', provisionAmount: new Prisma.Decimal(50) },
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
          contract: { id: 'c1', status: 'OVERDUE' },
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const badDebtProvisionTemplate = (service as any).badDebtProvisionTemplate;
      await service.calculateProvisions('user-1');

      expect(badDebtProvisionTemplate.execute).toHaveBeenCalledTimes(1);
      const callArgs = badDebtProvisionTemplate.execute.mock.calls[0][0];
      expect(callArgs.contractId).toBe('c1');
      // new = 150 (B2 15%), prev = 50, provisionAmount (delta) = 100
      expect(Number(callArgs.provisionAmount)).toBeCloseTo(100, 4);
      expect(callArgs.period).toMatch(/^\d{4}-\d{2}$/);
    });

    it('skips BadDebtProvisionTemplate.execute when delta is zero (no change in provision)', async () => {
      // Prior ACTIVE provision = same as new provision (1000 * 0.02 = 20)
      prisma.badDebtProvision.findMany.mockResolvedValue([
        { contractId: 'c1', provisionAmount: new Prisma.Decimal(20) },
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
          contract: { id: 'c1', status: 'OVERDUE' },
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const badDebtProvisionTemplate = (service as any).badDebtProvisionTemplate;
      await service.calculateProvisions('user-1');

      expect(badDebtProvisionTemplate.execute).not.toHaveBeenCalled();
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
          contract: { id: 'c1', status: 'OVERDUE' },
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
          contract: { id: 'c1', status: 'OVERDUE' },
        },
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['1-30'].amount).toBeCloseTo(50, 4); // custom 0.05
    });

    it('falls back to defaults when systemConfig has malformed JSON', async () => {
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
          contract: { id: 'c1', status: 'OVERDUE' },
        },
      ]);
      const result = await service.calculateProvisions('user-1');
      expect(result.byBucket['1-30'].amount).toBeCloseTo(20, 4); // back to defaults
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

    it('marks contract CLOSED_BAD_DEBT and active provisions WRITTEN_OFF', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'OVERDUE' });
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
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'OVERDUE' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(5000));

      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'acct-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('tier 2 (10-30k): BM approver rejected — must be FM or OWNER', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'OVERDUE' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(20000));

      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'bm-2'),
      ).rejects.toThrow(/FINANCE_MANAGER|OWNER/);
    });

    it('tier 2 (10-30k): FM approver accepted', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'OVERDUE' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(20000));
      prisma.contract.update.mockResolvedValue({});

      const result = await service.writeOffBadDebt('c1', 'bm-1', 'fm-1');
      expect(result.status).toBe('CLOSED_BAD_DEBT');
    });

    it('tier 3 (>30k): non-OWNER approver rejected', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'OVERDUE' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(50000));

      await expect(
        service.writeOffBadDebt('c1', 'fm-1', 'fm-2'),
      ).rejects.toThrow(/OWNER/);
    });

    it('tier 3 (>30k): BM writer rejected (must be FM or OWNER)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'OVERDUE' });
      prisma.payment.findMany.mockResolvedValue(mkUnpaid(50000));

      await expect(
        service.writeOffBadDebt('c1', 'bm-1', 'owner-1'),
      ).rejects.toThrow(/FINANCE_MANAGER/);
    });

    it('tier 3 (>30k): FM writer + OWNER approver accepted', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'OVERDUE' });
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
          status: 'OVERDUE',
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

      it('records provisionAmount from existing ACTIVE provisions', async () => {
        prisma.badDebtProvision.findMany.mockResolvedValue([
          { provisionAmount: new Prisma.Decimal(1_000) },
          { provisionAmount: new Prisma.Decimal(500) },
        ]);
        await service.writeOffBadDebt('c1', 'bm-1', 'fm-1');
        const data = prisma.badDebtWriteOffAuditLog.create.mock.calls[0][0].data;
        expect(Number(data.provisionAmount)).toBe(1_500);
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

  describe('reverseStageOnPayment — CPA Policy A §3.6', () => {
    function setActiveProvision(opts: {
      provisionAmount: number;
      provisionRate: number;
      agingBucket: string;
    }) {
      prisma.badDebtProvision.findFirst.mockResolvedValue({
        id: 'prov-1',
        contractId: 'ct-1',
        agingBucket: opts.agingBucket,
        daysOverdue: 45,
        outstandingAmount: new Prisma.Decimal(2000),
        provisionRate: new Prisma.Decimal(opts.provisionRate),
        provisionAmount: new Prisma.Decimal(opts.provisionAmount),
        status: 'ACTIVE',
      });
    }

    function setOverduePayments(rows: Array<{ daysAgo: number; due: number; paid: number }>) {
      const now = Date.now();
      prisma.payment.findMany.mockResolvedValue(
        rows.map((r, i) => ({
          id: `p-${i}`,
          dueDate: new Date(now - r.daysAgo * 24 * 60 * 60 * 1000),
          amountDue: new Prisma.Decimal(r.due),
          amountPaid: new Prisma.Decimal(r.paid),
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

    it('returns null when bucket did not drop (new rate >= old rate)', async () => {
      // Existing B2 provision @ 15%; overdue still 45 days → still B2 → no reverse.
      setActiveProvision({ provisionAmount: 300, provisionRate: 0.15, agingBucket: '31-60' });
      setOverduePayments([{ daysAgo: 45, due: 1000, paid: 0 }]);
      const result = await service.reverseStageOnPayment('ct-1');
      expect(result).toBeNull();
    });

    it('reverses delta when bucket drops B2 → B1 and updates provision row', async () => {
      // Existing B2 (15%) on 2000 = 300 provision.
      // After payment: aging now 15 days (B1) on 1500 outstanding = 1500*0.02 = 30 provision.
      // Reverse delta = 300 - 30 = 270.
      setActiveProvision({ provisionAmount: 300, provisionRate: 0.15, agingBucket: '31-60' });
      setOverduePayments([{ daysAgo: 15, due: 1500, paid: 0 }]);

      const result = await service.reverseStageOnPayment('ct-1');

      expect(result).not.toBeNull();
      expect(result!.fromBucket).toBe('31-60');
      expect(result!.toBucket).toBe('1-30');
      expect(result!.reverseAmount).toBe('270.00');

      // Provision row updated to new bucket / amount
      const updateCall = prisma.badDebtProvision.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('prov-1');
      expect(updateCall.data.agingBucket).toBe('1-30');
      expect(updateCall.data.provisionAmount.toString()).toBe('30');
    });

    it('reverses entire provision and marks REVERSED when contract becomes fully current', async () => {
      setActiveProvision({ provisionAmount: 300, provisionRate: 0.15, agingBucket: '31-60' });
      // No overdue payments at all
      prisma.payment.findMany.mockResolvedValue([]);

      const result = await service.reverseStageOnPayment('ct-1');

      expect(result).not.toBeNull();
      expect(result!.toBucket).toBe('CURRENT');
      expect(result!.reverseAmount).toBe('300.00');

      const updateCall = prisma.badDebtProvision.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('REVERSED');
    });
  });
});
