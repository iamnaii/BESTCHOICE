import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueKpiService } from './kpi.service';

const mockPrisma = {
  payment: {
    aggregate: jest.fn(),
    findFirst: jest.fn(),
    // C3 fix: batched promise-kept lookup uses findMany instead of N+1 findFirst
    findMany: jest.fn().mockResolvedValue([]),
  },
  contract: {
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  callLog: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn().mockResolvedValue([]),
  },
};

function setupDefaultMocks() {
  mockPrisma.payment.aggregate.mockResolvedValue({
    _sum: { amountDue: '1000000.00', amountPaid: '200000.00', lateFee: '45000.00' },
  });
  mockPrisma.contract.count.mockResolvedValue(34);
  mockPrisma.callLog.count
    .mockResolvedValueOnce(12) // promisedCount (future)
    .mockResolvedValueOnce(5); // totalPromised (last 7d)
  mockPrisma.callLog.findMany.mockResolvedValue([]); // no candidates → keptCount = 0
  mockPrisma.contract.groupBy.mockResolvedValue([]);
}

describe('OverdueKpiService', () => {
  let service: OverdueKpiService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueKpiService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(OverdueKpiService);
  });

  describe('getKpi', () => {
    it('returns all 7 required fields with correct types', async () => {
      setupDefaultMocks();

      const result = await service.getKpi({
        range: '7d',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result).toHaveProperty('totalOutstanding');
      expect(result).toHaveProperty('totalLateFees');
      expect(result).toHaveProperty('queueToday');
      expect(result).toHaveProperty('queueTodayTrend');
      expect(result).toHaveProperty('promisedCount');
      expect(result).toHaveProperty('promiseKeptRate7d');
      expect(result).toHaveProperty('avgCollectorWorkload');

      expect(typeof result.totalOutstanding).toBe('number');
      expect(typeof result.totalLateFees).toBe('number');
      expect(typeof result.queueToday).toBe('number');
      expect(typeof result.queueTodayTrend).toBe('number');
      expect(typeof result.promisedCount).toBe('number');
      expect(typeof result.promiseKeptRate7d).toBe('number');
      expect(typeof result.avgCollectorWorkload).toBe('number');

      // Verify computed values
      expect(result.totalOutstanding).toBe(800000); // 1000000 - 200000
      expect(result.totalLateFees).toBe(45000);
      expect(result.queueToday).toBe(34);
      expect(result.queueTodayTrend).toBe(0); // placeholder
      expect(result.promisedCount).toBe(12);
    });

    it('returns cached result on second call within 60s', async () => {
      setupDefaultMocks();

      const result1 = await service.getKpi({
        range: '7d',
        userRole: 'OWNER',
        userBranchId: null,
      });

      // Second call — mocks should NOT be called again
      const result2 = await service.getKpi({
        range: '7d',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result1).toBe(result2); // same object reference (cached)
      // payment.aggregate was called only once (not twice)
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledTimes(1);
    });

    it('does NOT use cache for different range (different cache key)', async () => {
      setupDefaultMocks();
      // Setup for second call
      mockPrisma.payment.aggregate.mockResolvedValue({
        _sum: { amountDue: '500000.00', amountPaid: '100000.00', lateFee: '20000.00' },
      });
      mockPrisma.contract.count.mockResolvedValue(20);
      mockPrisma.callLog.count
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(3);
      mockPrisma.callLog.findMany.mockResolvedValue([]);
      mockPrisma.contract.groupBy.mockResolvedValue([]);

      await service.getKpi({ range: '7d', userRole: 'OWNER', userBranchId: null });
      await service.getKpi({ range: '30d', userRole: 'OWNER', userBranchId: null });

      // Both calls hit DB (different cache keys)
      expect(mockPrisma.payment.aggregate).toHaveBeenCalledTimes(2);
    });

    it('SALES users get branch-scoped query — branchId filter applied', async () => {
      setupDefaultMocks();

      await service.getKpi({
        range: '7d',
        userRole: 'SALES',
        userBranchId: 'branch-sales-1',
      });

      // Verify payment.aggregate was called with branchId in contract scope
      const aggregateCall = mockPrisma.payment.aggregate.mock.calls[0][0];
      expect(aggregateCall.where.contract.branchId).toBe('branch-sales-1');

      // Verify contract.count was called with branchId
      const countCall = mockPrisma.contract.count.mock.calls[0][0];
      expect(countCall.where.branchId).toBe('branch-sales-1');
    });

    it('avgCollectorWorkload is 0 for non-OWNER roles (no groupBy query)', async () => {
      setupDefaultMocks();

      const result = await service.getKpi({
        range: '7d',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
      });

      expect(result.avgCollectorWorkload).toBe(0);
      // groupBy should NOT have been called for BRANCH_MANAGER
      expect(mockPrisma.contract.groupBy).not.toHaveBeenCalled();
    });

    it('avgCollectorWorkload computes correctly for OWNER with assigned contracts', async () => {
      mockPrisma.payment.aggregate.mockResolvedValue({
        _sum: { amountDue: '0', amountPaid: '0', lateFee: '0' },
      });
      mockPrisma.contract.count.mockResolvedValue(0);
      mockPrisma.callLog.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockPrisma.callLog.findMany.mockResolvedValue([]);
      mockPrisma.contract.groupBy.mockResolvedValue([
        { assignedToId: 'user-1', _count: { _all: 10 } },
        { assignedToId: 'user-2', _count: { _all: 20 } },
      ]);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'user-1', name: 'แนน' },
        { id: 'user-2', name: 'กวาง' },
      ]);

      const result = await service.getKpi({
        range: '7d',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.avgCollectorWorkload).toBe(15); // (10 + 20) / 2
      expect(result.collectorWorkload).toEqual([
        { userId: 'user-2', name: 'กวาง', count: 20 },
        { userId: 'user-1', name: 'แนน', count: 10 },
      ]);
    });

    it('promiseKeptRate7d is 0 when there are no promises in last 7d', async () => {
      mockPrisma.payment.aggregate.mockResolvedValue({
        _sum: { amountDue: '0', amountPaid: '0', lateFee: '0' },
      });
      mockPrisma.contract.count.mockResolvedValue(0);
      mockPrisma.callLog.count
        .mockResolvedValueOnce(0) // future promised
        .mockResolvedValueOnce(0); // past 7d total = 0
      mockPrisma.callLog.findMany.mockResolvedValue([]); // no candidates
      mockPrisma.contract.groupBy.mockResolvedValue([]);

      const result = await service.getKpi({
        range: '7d',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.promiseKeptRate7d).toBe(0);
    });

    it('promiseKeptRate7d rounds to 2 decimal places', async () => {
      const candidateDate = new Date(Date.now() - 2 * 86400000);
      mockPrisma.payment.aggregate.mockResolvedValue({
        _sum: { amountDue: '0', amountPaid: '0', lateFee: '0' },
      });
      mockPrisma.contract.count.mockResolvedValue(0);
      mockPrisma.callLog.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3); // 3 total promises
      // 3 candidates (keptCandidates)
      mockPrisma.callLog.findMany.mockResolvedValue([
        { contractId: 'c1', settlementDate: candidateDate },
        { contractId: 'c2', settlementDate: candidateDate },
        { contractId: 'c3', settlementDate: candidateDate },
      ]);
      // C3 fix: single findMany returns paid payments for all 3 contracts.
      // Only c1 has a payment paid on/after settlementDate (kept); c2/c3 absent → broken.
      mockPrisma.payment.findMany.mockResolvedValueOnce([
        { contractId: 'c1', updatedAt: new Date(candidateDate.getTime() + 86400000) },
      ]);
      mockPrisma.contract.groupBy.mockResolvedValue([]);

      const result = await service.getKpi({
        range: '7d',
        userRole: 'OWNER',
        userBranchId: null,
      });

      // 1/3 = 0.333... → rounds to 0.33
      expect(result.promiseKeptRate7d).toBe(0.33);
    });
  });
});
