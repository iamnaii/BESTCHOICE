import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueQueueService } from './queue.service';

const mockPrisma = {
  contract: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

describe('OverdueQueueService', () => {
  let service: OverdueQueueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueQueueService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(OverdueQueueService);
  });

  function makeContract(overrides: Partial<any> = {}) {
    return {
      id: 'contract-1',
      contractNumber: 'BC-2024-001',
      status: 'OVERDUE',
      dunningStage: 'STAGE_1',
      noAnswerCount: 0,
      needsSkipTracing: false,
      deviceLocked: false,
      customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678', lineId: 'line123' },
      branch: { id: 'branch-1', name: 'สาขาลาดพร้าว' },
      assignedTo: { id: 'user-1', name: 'นักติดตาม 1' },
      payments: [
        {
          amountDue: '5000.00',
          amountPaid: '0.00',
          lateFee: '150.00',
          dueDate: new Date(Date.now() - 10 * 86400000), // 10 days ago
          status: 'OVERDUE',
        },
      ],
      callLogs: [],
      ...overrides,
    };
  }

  describe('getQueue — today tab', () => {
    it('returns correct ContractRow shape for today tab', async () => {
      const contract = makeContract({
        callLogs: [{ result: 'NO_ANSWER', calledAt: new Date(Date.now() - 86400000), settlementDate: null }],
      });
      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];

      // Verify all ContractRow fields present
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('contractNumber');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('dunningStage');
      expect(row).toHaveProperty('customer');
      expect(row).toHaveProperty('branch');
      expect(row).toHaveProperty('assignedTo');
      expect(row).toHaveProperty('outstanding');
      expect(row).toHaveProperty('daysOverdue');
      expect(row).toHaveProperty('lastCallResult');
      expect(row).toHaveProperty('lastCallAt');
      expect(row).toHaveProperty('noAnswerCount');
      expect(row).toHaveProperty('settlementDate');
      expect(row).toHaveProperty('needsSkipTracing');
      expect(row).toHaveProperty('deviceLocked');

      // Verify computed fields
      expect(row.outstanding).toBe(5150); // 5000 - 0 + 150
      expect(row.daysOverdue).toBe(10);
      expect(row.lastCallResult).toBe('NO_ANSWER');
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });
  });

  describe('SALES branch scoping', () => {
    it('forces SALES user to their own branchId in query', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'today',
        userRole: 'SALES',
        userBranchId: 'branch-sales',
        branchId: 'branch-other', // should be ignored
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      expect(callArg.where.branchId).toBe('branch-sales');
    });

    it('OWNER with branchId filter uses provided branchId', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        branchId: 'branch-filtered',
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      expect(callArg.where.branchId).toBe('branch-filtered');
    });
  });

  describe('followup tab', () => {
    it('query filter uses noAnswerCount gte 1 lt 3 (excludes >= 3)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'followup',
        userRole: 'OWNER',
        userBranchId: null,
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      expect(callArg.where.noAnswerCount).toEqual({ gte: 1, lt: 3 });
    });

    it('followup returns only contracts with noAnswerCount 1-2 from mock', async () => {
      const c1 = makeContract({ noAnswerCount: 1, status: 'OVERDUE' });
      const c2 = makeContract({ id: 'contract-2', noAnswerCount: 2, status: 'DEFAULT' });
      mockPrisma.contract.findMany.mockResolvedValueOnce([c1, c2]);
      mockPrisma.contract.count.mockResolvedValueOnce(2);

      const result = await service.getQueue({
        tab: 'followup',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('promise tab', () => {
    it('promise tab query includes settlementDate window (today-3 to today+30)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      const before = Date.now();
      await service.getQueue({
        tab: 'promise',
        userRole: 'OWNER',
        userBranchId: null,
      });
      const after = Date.now();

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      const settlementFilter = callArg.where.callLogs.some.settlementDate;

      expect(settlementFilter.gte.getTime()).toBeGreaterThanOrEqual(before - 3 * 86400000 - 100);
      expect(settlementFilter.gte.getTime()).toBeLessThanOrEqual(after - 3 * 86400000 + 100);
      expect(settlementFilter.lte.getTime()).toBeGreaterThanOrEqual(before + 30 * 86400000 - 100);
      expect(settlementFilter.lte.getTime()).toBeLessThanOrEqual(after + 30 * 86400000 + 100);
    });

    it('includes future-dated and recently-passed settlements in result', async () => {
      const futureDated = makeContract({
        callLogs: [
          {
            result: 'PROMISED',
            calledAt: new Date(),
            settlementDate: new Date(Date.now() + 5 * 86400000), // 5 days in future
          },
        ],
      });
      const recentlyPassed = makeContract({
        id: 'contract-past',
        callLogs: [
          {
            result: 'PROMISED',
            calledAt: new Date(),
            settlementDate: new Date(Date.now() - 2 * 86400000), // 2 days ago (within 3d)
          },
        ],
      });
      mockPrisma.contract.findMany.mockResolvedValueOnce([futureDated, recentlyPassed]);
      mockPrisma.contract.count.mockResolvedValueOnce(2);

      const result = await service.getQueue({
        tab: 'promise',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].settlementDate).toBeDefined();
      expect(result.data[1].settlementDate).toBeDefined();
    });
  });

  describe('pagination', () => {
    it('caps limit at 100 when input exceeds 100', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        limit: 200, // should be capped
      });

      expect(result.limit).toBe(100);
      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      expect(callArg.take).toBe(100);
    });

    it('uses default limit of 50 when not specified', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.limit).toBe(50);
    });
  });
});
