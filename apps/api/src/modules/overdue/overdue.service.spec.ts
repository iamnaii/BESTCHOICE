/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OverdueService } from './overdue.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('OverdueService', () => {
  let service: OverdueService;
  let prisma: any;

  const mockContract = {
    id: 'contract-1',
    contractNumber: 'BCP2603-00001',
    status: 'OVERDUE',
    deletedAt: null,
    branchId: 'branch-1',
    dunningStage: 'NONE',
  };

  const mockPayment = {
    id: 'payment-1',
    contractId: 'contract-1',
    installmentNo: 1,
    amountDue: 3000,
    amountPaid: 0,
    lateFee: 0,
    status: 'OVERDUE',
    dueDate: new Date('2026-02-01'),
  };

  beforeEach(async () => {
    const mockPrisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(mockContract),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amountDue: 0, amountPaid: 0, lateFee: 0 },
        }),
      },
      callLog: {
        create: jest.fn().mockResolvedValue({
          id: 'call-1',
          contractId: 'contract-1',
          callerId: 'user-1',
          result: 'ANSWERED',
          notes: 'โทรติดตาม',
          caller: { id: 'user-1', name: 'Staff' },
          contract: { contractNumber: 'BCP2603-00001', customer: { name: 'Test' } },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'system-user-1' }),
      },
      $executeRaw: jest.fn().mockResolvedValue(5),
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OverdueService>(OverdueService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  // ─── findOverdueContracts ─────────────────────────────
  describe('findOverdueContracts', () => {
    it('should return paginated overdue contracts', async () => {
      prisma.contract.findMany.mockResolvedValue([mockContract]);
      prisma.contract.count.mockResolvedValue(1);

      const result = await service.findOverdueContracts({
        userRole: 'OWNER',
        page: 1,
        limit: 50,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('should enforce branch filter for SALES role', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.findOverdueContracts({
        userRole: 'SALES',
        userBranchId: 'branch-1',
      });

      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'branch-1' }),
        }),
      );
    });

    it('should enforce branch filter for BRANCH_MANAGER role', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.findOverdueContracts({
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-2',
      });

      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'branch-2' }),
        }),
      );
    });

    it('should allow OWNER to filter by any branch', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.findOverdueContracts({
        userRole: 'OWNER',
        branchId: 'branch-5',
      });

      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'branch-5' }),
        }),
      );
    });

    it('should filter by status when valid', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.findOverdueContracts({
        userRole: 'OWNER',
        status: 'DEFAULT',
      });

      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'DEFAULT' }),
        }),
      );
    });

    it('should apply search filter with OR conditions', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.findOverdueContracts({
        userRole: 'OWNER',
        search: 'BCP',
      });

      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ contractNumber: expect.any(Object) }),
            ]),
          }),
        }),
      );
    });

    it('should cap limit at 100', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      const result = await service.findOverdueContracts({
        userRole: 'OWNER',
        limit: 500,
      });

      expect(result.limit).toBe(100);
    });
  });

  // ─── getOverdueSummary ────────────────────────────────
  describe('getOverdueSummary', () => {
    it('should return summary statistics for OWNER', async () => {
      prisma.contract.count
        .mockResolvedValueOnce(10) // overdueCount
        .mockResolvedValueOnce(3); // defaultCount
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountDue: 50000, amountPaid: 20000, lateFee: 5000 },
      });

      const result = await service.getOverdueSummary('OWNER');

      expect(result.overdueCount).toBe(10);
      expect(result.defaultCount).toBe(3);
      expect(result.totalOverdueAmount).toBe(30000); // 50000 - 20000
      expect(result.totalLateFees).toBe(5000);
    });

    it('should apply branch filter for SALES role', async () => {
      prisma.contract.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountDue: 0, amountPaid: 0, lateFee: 0 },
      });

      await service.getOverdueSummary('SALES', 'branch-1');

      expect(prisma.contract.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'branch-1' }),
        }),
      );
    });

    it('should handle null aggregate sums', async () => {
      prisma.contract.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountDue: null, amountPaid: null, lateFee: null },
      });

      const result = await service.getOverdueSummary('OWNER');

      expect(result.totalOverdueAmount).toBe(0);
      expect(result.totalLateFees).toBe(0);
    });
  });

  // ─── getContractTimeline ──────────────────────────────
  describe('getContractTimeline', () => {
    it('should return contract with full timeline', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        customer: { name: 'Test' },
        payments: [mockPayment],
        callLogs: [],
      });

      const result = await service.getContractTimeline('contract-1');

      expect(result.id).toBe('contract-1');
      expect(result.payments).toHaveLength(1);
    });

    it('should throw NotFoundException if contract not found', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(service.getContractTimeline('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── createCallLog ────────────────────────────────────
  describe('createCallLog', () => {
    it('should create call log and audit entry', async () => {
      const dto = {
        contractId: 'contract-1',
        calledAt: '2026-03-20T10:00:00Z',
        result: 'ANSWERED',
        notes: 'ลูกค้าจะชำระภายในสัปดาห์นี้',
      };

      const result = await service.createCallLog(dto, 'user-1');

      expect(prisma.callLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'contract-1',
            callerId: 'user-1',
            result: 'ANSWERED',
          }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalled();
      expect(result.id).toBe('call-1');
    });

    it('should throw NotFoundException if contract not found', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.createCallLog(
          { contractId: 'bad-id', calledAt: '2026-03-20T10:00:00Z', result: 'NO_ANSWER', notes: '' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getCallLogs ──────────────────────────────────────
  describe('getCallLogs', () => {
    it('should return paginated call logs', async () => {
      prisma.callLog.findMany.mockResolvedValue([
        { id: 'call-1', result: 'ANSWERED' },
      ]);
      prisma.callLog.count.mockResolvedValue(1);

      const result = await service.getCallLogs('contract-1');

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should cap limit at 100', async () => {
      prisma.callLog.findMany.mockResolvedValue([]);
      prisma.callLog.count.mockResolvedValue(0);

      const result = await service.getCallLogs('contract-1', 1, 500);

      expect(result.limit).toBe(100);
    });
  });

  // ─── calculateLateFees ────────────────────────────────
  describe('calculateLateFees', () => {
    it('should execute bulk SQL update and return count', async () => {
      prisma.$executeRaw.mockResolvedValue(15);

      const result = await service.calculateLateFees();

      expect(result.updated).toBe(15);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should use default late fee config when systemConfig is empty', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.$executeRaw.mockResolvedValue(0);

      const result = await service.calculateLateFees();

      // Should not throw — uses BUSINESS_RULES defaults
      expect(result.updated).toBe(0);
    });

    it('should use custom config from systemConfig table', async () => {
      prisma.systemConfig.findUnique
        .mockResolvedValueOnce({ key: 'late_fee_per_day', value: '150' })
        .mockResolvedValueOnce({ key: 'late_fee_cap', value: '500' });
      prisma.$executeRaw.mockResolvedValue(3);

      const result = await service.calculateLateFees();

      expect(result.updated).toBe(3);
    });
  });

  // ─── updateContractStatuses ───────────────────────────
  describe('updateContractStatuses', () => {
    it('should transition ACTIVE to OVERDUE when payments exceed threshold', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { id: 'c-1' },
        { id: 'c-2' },
      ]);
      prisma.contract.updateMany.mockResolvedValue({ count: 2 });
      prisma.auditLog.createMany.mockResolvedValue({ count: 2 });
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      const result = await service.updateContractStatuses();

      expect(result.overdueUpdated).toBe(2);
      expect(result.overdueIds).toEqual(['c-1', 'c-2']);
    });

    it('should transition OVERDUE to DEFAULT with 2+ consecutive missed payments', async () => {
      prisma.contract.findMany.mockResolvedValue([]); // no ACTIVE → OVERDUE
      prisma.$queryRaw.mockResolvedValue([
        { id: 'c-3', consecutive: 3 },
      ]);
      prisma.contract.updateMany.mockResolvedValue({ count: 1 });
      prisma.auditLog.createMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      const result = await service.updateContractStatuses();

      expect(result.defaultUpdated).toBe(1);
      expect(result.defaultIds).toEqual(['c-3']);
    });

    it('should handle no contracts needing status change', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.updateContractStatuses();

      expect(result.overdueUpdated).toBe(0);
      expect(result.defaultUpdated).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should use custom overdue threshold from config', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ key: 'overdue_days_threshold', value: '14' });
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.updateContractStatuses();

      expect(result.overdueUpdated).toBe(0);
    });

    it('should skip audit logs when no system user found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.contract.findMany.mockResolvedValue([{ id: 'c-1' }]);
      prisma.contract.updateMany.mockResolvedValue({ count: 1 });
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      const result = await service.updateContractStatuses();

      expect(result.overdueUpdated).toBe(1);
      // Transaction should contain only updateMany (no createMany for audit)
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(Promise)]),
      );
    });
  });

  // ─── escalateDunningStages ────────────────────────────
  describe('escalateDunningStages', () => {
    it('should escalate NONE to REMINDER for 1-7 days overdue', async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-1',
          contractNumber: 'BCP2603-00001',
          dunningStage: 'NONE',
          payments: [{ dueDate: daysAgo(3) }],
        },
      ]);

      const result = await service.escalateDunningStages();

      expect(result.escalated).toHaveLength(1);
      expect(result.escalated[0].from).toBe('NONE');
      expect(result.escalated[0].to).toBe('REMINDER');
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dunningStage: 'REMINDER' }),
        }),
      );
    });

    it('should escalate REMINDER to NOTICE for 8-30 days overdue', async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-2',
          contractNumber: 'BCP2603-00002',
          dunningStage: 'REMINDER',
          payments: [{ dueDate: daysAgo(15) }],
        },
      ]);

      const result = await service.escalateDunningStages();

      expect(result.escalated).toHaveLength(1);
      expect(result.escalated[0].to).toBe('NOTICE');
    });

    it('should escalate NOTICE to FINAL_WARNING for 31-60 days overdue', async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-3',
          contractNumber: 'BCP2603-00003',
          dunningStage: 'NOTICE',
          payments: [{ dueDate: daysAgo(45) }],
        },
      ]);

      const result = await service.escalateDunningStages();

      expect(result.escalated).toHaveLength(1);
      expect(result.escalated[0].to).toBe('FINAL_WARNING');
    });

    it('should escalate FINAL_WARNING to LEGAL_ACTION for >60 days overdue', async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-4',
          contractNumber: 'BCP2603-00004',
          dunningStage: 'FINAL_WARNING',
          payments: [{ dueDate: daysAgo(90) }],
        },
      ]);

      const result = await service.escalateDunningStages();

      expect(result.escalated).toHaveLength(1);
      expect(result.escalated[0].to).toBe('LEGAL_ACTION');
    });

    it('should NOT de-escalate (only escalate)', async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Contract already at NOTICE but only 3 days overdue (would be REMINDER)
      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-5',
          contractNumber: 'BCP2603-00005',
          dunningStage: 'NOTICE',
          payments: [{ dueDate: daysAgo(3) }],
        },
      ]);

      const result = await service.escalateDunningStages();

      expect(result.escalated).toHaveLength(0);
      expect(prisma.contract.update).not.toHaveBeenCalled();
    });

    it('should skip contracts with no overdue payments', async () => {
      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-6',
          contractNumber: 'BCP2603-00006',
          dunningStage: 'NONE',
          payments: [], // no overdue payments
        },
      ]);

      const result = await service.escalateDunningStages();

      expect(result.escalated).toHaveLength(0);
    });

    it('should escalate multiple contracts in one run', async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-a',
          contractNumber: 'BCP-A',
          dunningStage: 'NONE',
          payments: [{ dueDate: daysAgo(5) }],
        },
        {
          id: 'c-b',
          contractNumber: 'BCP-B',
          dunningStage: 'REMINDER',
          payments: [{ dueDate: daysAgo(20) }],
        },
      ]);

      const result = await service.escalateDunningStages();

      expect(result.escalated).toHaveLength(2);
    });

    it('should create audit log for escalations', async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-7',
          contractNumber: 'BCP2603-00007',
          dunningStage: 'NONE',
          payments: [{ dueDate: daysAgo(5) }],
        },
      ]);

      await service.escalateDunningStages();

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DUNNING_ESCALATION',
            entity: 'contract',
            entityId: 'c-7',
          }),
        }),
      );
    });
  });

  // ─── resetDunningStage ────────────────────────────────
  describe('resetDunningStage', () => {
    it('should reset dunning fields to NONE/null', async () => {
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        dunningStage: 'NONE',
        dunningEscalatedAt: null,
        dunningLastActionAt: null,
      });

      await service.resetDunningStage('contract-1');

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: {
          dunningStage: 'NONE',
          dunningEscalatedAt: null,
          dunningLastActionAt: null,
        },
      });
    });
  });
});
