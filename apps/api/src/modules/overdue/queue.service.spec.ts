import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueQueueService } from './queue.service';
import { NextBestActionService } from './next-best-action.service';

const mockPrisma = {
  contract: {
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  callLog: {
    groupBy: jest.fn(),
    findMany: jest.fn(),
  },
  dunningAction: {
    groupBy: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: {
    groupBy: jest.fn(),
  },
  mdmLockRequest: {
    findMany: jest.fn(),
  },
  contractLetter: {
    groupBy: jest.fn(),
  },
  paymentEvidence: {
    groupBy: jest.fn(),
  },
  contractDailySnapshot: {
    findMany: jest.fn(),
  },
  contractSnooze: {
    findMany: jest.fn(),
  },
  // Z10: latestLineDeliveryStatus enrichment
  chatMessage: {
    findMany: jest.fn(),
  },
};

function resetEnrichmentMocks() {
  mockPrisma.callLog.groupBy.mockResolvedValue([]);
  mockPrisma.callLog.findMany.mockResolvedValue([]);
  mockPrisma.dunningAction.groupBy.mockResolvedValue([]);
  mockPrisma.auditLog.groupBy.mockResolvedValue([]);
  mockPrisma.mdmLockRequest.findMany.mockResolvedValue([]);
  mockPrisma.contract.groupBy.mockResolvedValue([]);
  mockPrisma.dunningAction.findMany.mockResolvedValue([]);
  mockPrisma.contractLetter.groupBy.mockResolvedValue([]);
  mockPrisma.paymentEvidence.groupBy.mockResolvedValue([]);
  mockPrisma.contractDailySnapshot.findMany.mockResolvedValue([]);
  mockPrisma.contractSnooze.findMany.mockResolvedValue([]);
  mockPrisma.chatMessage.findMany.mockResolvedValue([]);
}

describe('OverdueQueueService', () => {
  let service: OverdueQueueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetEnrichmentMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueQueueService,
        NextBestActionService,
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
      customerId: 'cust-1',
      noAnswerCount: 0,
      needsSkipTracing: false,
      deviceLocked: false,
      customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678', lineIdFinance: 'line123' },
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
      // New enrichment fields
      expect(row).toHaveProperty('lastContactedAt');
      expect(row).toHaveProperty('brokenPromiseCount');
      expect(row).toHaveProperty('mdmState');
      expect(row).toHaveProperty('relatedContractsCount');
      expect(row).toHaveProperty('lastChannel');

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
    it('caps response limit at 100 when input exceeds 100', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        limit: 200, // should be capped
      });

      expect(result.limit).toBe(100);
      // Prisma fetch caps at 500 (then sorts in memory by priority + paginates).
      // Response `limit` field is still user-visible 100.
      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      expect(callArg.take).toBe(500);
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

  describe('priority score sort', () => {
    const mkContract = (overrides: Record<string, unknown>) => ({
      id: 'c-' + Math.random().toString(36).slice(2, 8),
      contractNumber: 'CN-x',
      status: 'OVERDUE',
      dunningStage: 'NONE',
      customerId: 'cu',
      customer: { id: 'cu', name: 'x', phone: '0', lineIdFinance: null },
      branch: { id: 'b', name: 'b' },
      assignedTo: null,
      noAnswerCount: 0,
      needsSkipTracing: false,
      deviceLocked: false,
      payments: [
        {
          amountDue: '1000',
          amountPaid: '0',
          lateFee: '0',
          dueDate: new Date(Date.now() - 10 * 86400000).toISOString(), // 10 days overdue
        },
      ],
      callLogs: [],
      _count: { callLogs: 0 },
      ...overrides,
    });

    it('sorts by priority score desc so biggest+oldest+no-answer surfaces first', async () => {
      const low = mkContract({
        id: 'low',
        payments: [{ amountDue: '500', amountPaid: '0', lateFee: '0', dueDate: new Date(Date.now() - 5 * 86400000).toISOString() }],
      }); // 500 * 5 * 1 * 1 = 2500
      const mid = mkContract({
        id: 'mid',
        payments: [{ amountDue: '2000', amountPaid: '0', lateFee: '0', dueDate: new Date(Date.now() - 20 * 86400000).toISOString() }],
      }); // 2000 * 20 * 1 * 1 = 40000
      const high = mkContract({
        id: 'high',
        noAnswerCount: 2,
        _count: { callLogs: 3 }, // 3 broken promises
        payments: [{ amountDue: '3000', amountPaid: '0', lateFee: '0', dueDate: new Date(Date.now() - 30 * 86400000).toISOString() }],
      }); // 3000 * 30 * 3 * 7 = 1,890,000

      mockPrisma.contract.findMany.mockResolvedValueOnce([low, mid, high]);
      mockPrisma.contract.count.mockResolvedValueOnce(3);

      const result = await service.getQueue({ tab: 'today', userRole: 'OWNER', userBranchId: null });

      expect(result.data.map((r) => r.id)).toEqual(['high', 'mid', 'low']);
      // __priorityScore should be stripped from response
      expect((result.data[0] as any).__priorityScore).toBeUndefined();
    });
  });

  describe('card indicators enrichment', () => {
    it('computes lastContactedAt as max of CallLog.createdAt and DunningAction.executedAt', async () => {
      const contract = makeContract();
      const callTs = new Date(Date.now() - 3 * 3600 * 1000); // 3h ago
      const actionTs = new Date(Date.now() - 1 * 3600 * 1000); // 1h ago (more recent)

      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.callLog.groupBy.mockResolvedValueOnce([
        { contractId: 'contract-1', _max: { createdAt: callTs } },
      ]);
      mockPrisma.dunningAction.groupBy.mockResolvedValueOnce([
        { contractId: 'contract-1', _max: { executedAt: actionTs } },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data[0].lastContactedAt).toEqual(actionTs);
    });

    it('falls back to CallLog.createdAt if no DunningAction', async () => {
      const contract = makeContract();
      const callTs = new Date(Date.now() - 3600 * 1000);

      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.callLog.groupBy.mockResolvedValueOnce([
        { contractId: 'contract-1', _max: { createdAt: callTs } },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data[0].lastContactedAt).toEqual(callTs);
    });

    it('returns null lastContactedAt when no contacts exist', async () => {
      const contract = makeContract();
      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data[0].lastContactedAt).toBeNull();
    });

    it('includes brokenPromiseCount from BROKEN_PROMISE audit events', async () => {
      const contract = makeContract();
      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.auditLog.groupBy.mockResolvedValueOnce([
        { entityId: 'contract-1', _count: { _all: 2 } },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data[0].brokenPromiseCount).toBe(2);
    });

    it('maps MdmLockRequest status to mdmState — PENDING/LOCKED/UNLOCKED/NONE', async () => {
      const contract = makeContract();
      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.mdmLockRequest.findMany.mockResolvedValueOnce([
        { contractId: 'contract-1', status: 'EXECUTED_API' },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data[0].mdmState).toBe('LOCKED');
    });

    it('returns NONE mdmState when no MdmLockRequest exists', async () => {
      const contract = makeContract();
      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data[0].mdmState).toBe('NONE');
    });

    it('computes relatedContractsCount as other active contracts for customer', async () => {
      const contract = makeContract();
      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.contract.groupBy.mockResolvedValueOnce([
        { customerId: 'cust-1', _count: { _all: 3 } },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      // 3 total active → 2 others
      expect(result.data[0].relatedContractsCount).toBe(2);
    });

    it('maps latest DunningAction channel to lastChannel (LINE/SMS/CALL)', async () => {
      const contract = makeContract();
      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([
        { contractId: 'contract-1', channel: 'LINE' },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data[0].lastChannel).toBe('LINE');
    });

    it('returns null lastChannel when no DunningAction exists', async () => {
      const contract = makeContract();
      mockPrisma.contract.findMany.mockResolvedValueOnce([contract]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.data[0].lastChannel).toBeNull();
    });

    it('batch-loads enrichment via 10 aggregate queries (no N+1)', async () => {
      const contracts = [makeContract(), makeContract({ id: 'c2', customerId: 'cust-2' })];
      mockPrisma.contract.findMany.mockResolvedValueOnce(contracts);
      mockPrisma.contract.count.mockResolvedValueOnce(2);

      await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        userId: 'enricher-user',
      });

      // One call per aggregate regardless of row count — no N+1
      expect(mockPrisma.callLog.groupBy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.dunningAction.groupBy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditLog.groupBy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.mdmLockRequest.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.contract.groupBy).toHaveBeenCalledTimes(1);
      // 2 dunningAction.findMany calls total allowed (one for lastChannel)
      expect(mockPrisma.dunningAction.findMany).toHaveBeenCalledTimes(1);
      // New in v-P0-final: letterCount + slipReviewPending enrichment
      expect(mockPrisma.contractLetter.groupBy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.paymentEvidence.groupBy).toHaveBeenCalledTimes(1);
      // Task 10: trending arrow + per-user snooze badge enrichment
      expect(mockPrisma.contractDailySnapshot.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.contractSnooze.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('filters', () => {
    function makeContractWithDays(id: string, days: number): any {
      return {
        id,
        contractNumber: `BC-${id}`,
        status: 'OVERDUE',
        dunningStage: 'NONE',
        customerId: `cust-${id}`,
        noAnswerCount: 0,
        needsSkipTracing: false,
        deviceLocked: false,
        customer: { id: `cust-${id}`, name: `ลูกค้า ${id}`, phone: '0800000000', lineIdFinance: null },
        branch: { id: 'branch-1', name: 'สาขา 1' },
        assignedTo: null,
        payments: [
          {
            amountDue: '5000.00',
            amountPaid: '0.00',
            lateFee: '0',
            dueDate: new Date(Date.now() - days * 86400000),
            status: 'OVERDUE',
          },
        ],
        callLogs: [],
        _count: { callLogs: 0 },
      };
    }

    it('filters by overdueBuckets (8-30 and 31-60 range)', async () => {
      const contracts = [
        makeContractWithDays('a', 3), // 1-7
        makeContractWithDays('b', 15), // 8-30
        makeContractWithDays('c', 45), // 31-60
        makeContractWithDays('d', 75), // 61-90
        makeContractWithDays('e', 120), // 90+
      ];
      mockPrisma.contract.findMany.mockResolvedValueOnce(contracts);
      mockPrisma.contract.count.mockResolvedValueOnce(5);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        overdueBuckets: ['8-30', '31-60'] as any,
      });

      const ids = result.data.map((r) => r.id).sort();
      expect(ids).toEqual(['b', 'c']);
    });

    it('filters by outstanding range (min/max)', async () => {
      const small = { ...makeContractWithDays('small', 10) };
      small.payments = [
        { amountDue: '1000', amountPaid: '0', lateFee: '0', dueDate: new Date(Date.now() - 10 * 86400000) },
      ];
      const mid = { ...makeContractWithDays('mid', 10) };
      mid.payments = [
        { amountDue: '10000', amountPaid: '0', lateFee: '0', dueDate: new Date(Date.now() - 10 * 86400000) },
      ];
      const large = { ...makeContractWithDays('large', 10) };
      large.payments = [
        { amountDue: '50000', amountPaid: '0', lateFee: '0', dueDate: new Date(Date.now() - 10 * 86400000) },
      ];
      mockPrisma.contract.findMany.mockResolvedValueOnce([small, mid, large]);
      mockPrisma.contract.count.mockResolvedValueOnce(3);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        minOutstanding: 5000,
        maxOutstanding: 20000,
      });

      expect(result.data.map((r) => r.id)).toEqual(['mid']);
    });

    it('filters by minBrokenPromise using enriched count', async () => {
      const a = makeContractWithDays('a', 10);
      const b = makeContractWithDays('b', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([a, b]);
      mockPrisma.contract.count.mockResolvedValueOnce(2);
      mockPrisma.auditLog.groupBy.mockResolvedValueOnce([
        { entityId: 'a', _count: { _all: 2 } },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        minBrokenPromise: 1,
      });

      expect(result.data.map((r) => r.id)).toEqual(['a']);
      expect(result.data[0].brokenPromiseCount).toBeGreaterThanOrEqual(1);
    });

    it('filters by lastContacted=never (rows with no call or dunning action)', async () => {
      const a = makeContractWithDays('a', 10);
      const b = makeContractWithDays('b', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([a, b]);
      mockPrisma.contract.count.mockResolvedValueOnce(2);
      mockPrisma.callLog.groupBy.mockResolvedValueOnce([
        { contractId: 'a', _max: { createdAt: new Date() } },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        lastContacted: 'never' as any,
      });

      expect(result.data.map((r) => r.id)).toEqual(['b']);
      expect(result.data[0].lastContactedAt).toBeNull();
    });

    it('filters by mdmState=not_locked (excludes LOCKED/PENDING)', async () => {
      const a = makeContractWithDays('a', 10);
      const b = makeContractWithDays('b', 10);
      const c = makeContractWithDays('c', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([a, b, c]);
      mockPrisma.contract.count.mockResolvedValueOnce(3);
      mockPrisma.mdmLockRequest.findMany.mockResolvedValueOnce([
        { contractId: 'a', status: 'EXECUTED_API' }, // LOCKED
        { contractId: 'b', status: 'PENDING' }, // PENDING
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        mdmState: 'not_locked' as any,
      });

      expect(result.data.map((r) => r.id)).toEqual(['c']);
    });

    it('applies assignedToId=self via user id on where clause', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        userId: 'me-user-123',
        assignedToId: 'self',
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      expect(callArg.where.assignedToId).toBe('me-user-123');
    });

    it('applies contractStatuses filter in Prisma where', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        contractStatuses: ['DEFAULT', 'LEGAL'] as any,
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      expect(callArg.where.status).toEqual({ in: ['DEFAULT', 'LEGAL'] });
    });

    it('applies productTypes filter via Product relation', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        productTypes: ['PHONE_USED'] as any,
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      expect(callArg.where.product).toEqual({ category: { in: ['PHONE_USED'] } });
    });

    it('returns truncated=true when fetch hits FETCH_CAP', async () => {
      const many = Array.from({ length: 500 }, (_, i) => makeContractWithDays(`c${i}`, 10));
      mockPrisma.contract.findMany.mockResolvedValueOnce(many);
      mockPrisma.contract.count.mockResolvedValueOnce(1200);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.truncated).toBe(true);
    });

    it('returns truncated=false when fetch under FETCH_CAP', async () => {
      const few = [makeContractWithDays('only', 10)];
      mockPrisma.contract.findMany.mockResolvedValueOnce(few);
      mockPrisma.contract.count.mockResolvedValueOnce(1);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(result.truncated).toBe(false);
    });

    it('filters by minLetterCount using ContractLetter groupBy count', async () => {
      const a = makeContractWithDays('a', 10);
      const b = makeContractWithDays('b', 10);
      const c = makeContractWithDays('c', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([a, b, c]);
      mockPrisma.contract.count.mockResolvedValueOnce(3);
      mockPrisma.contractLetter.groupBy.mockResolvedValueOnce([
        { contractId: 'a', _count: { _all: 3 } },
        { contractId: 'b', _count: { _all: 1 } },
        // c has no letters → 0 from the default
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        minLetterCount: 2,
      });

      expect(result.data.map((r) => r.id)).toEqual(['a']);
      expect(result.data[0].letterCount).toBe(3);
      // total reflects post-filter count, not raw SQL count
      expect(result.total).toBe(1);
    });

    it('filters by slipReviewPending=true (only rows with pending PaymentEvidence)', async () => {
      const a = makeContractWithDays('a', 10);
      const b = makeContractWithDays('b', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([a, b]);
      mockPrisma.contract.count.mockResolvedValueOnce(2);
      mockPrisma.paymentEvidence.groupBy.mockResolvedValueOnce([
        { contractId: 'a', _count: { _all: 2 } },
        // b has none
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        slipReviewPending: true,
      });

      expect(result.data.map((r) => r.id)).toEqual(['a']);
      expect(result.data[0].slipReviewPending).toBe(true);
    });

    it('slipReviewPending=false excludes contracts with pending slips', async () => {
      const a = makeContractWithDays('a', 10);
      const b = makeContractWithDays('b', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([a, b]);
      mockPrisma.contract.count.mockResolvedValueOnce(2);
      mockPrisma.paymentEvidence.groupBy.mockResolvedValueOnce([
        { contractId: 'a', _count: { _all: 1 } },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        slipReviewPending: false,
      });

      expect(result.data.map((r) => r.id)).toEqual(['b']);
      expect(result.data[0].slipReviewPending).toBe(false);
    });

    it('excludes contracts snoozed by current non-OWNER user (NOT { snoozes: { some } })', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
        userId: 'me-1',
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      const ands = (callArg.where.AND ?? []) as any[];
      const snoozeClause = ands.find((c) => c?.NOT?.snoozes);
      expect(snoozeClause).toBeDefined();
      expect(snoozeClause.NOT.snoozes.some.userId).toBe('me-1');
      expect(snoozeClause.NOT.snoozes.some.deletedAt).toBeNull();
      expect(snoozeClause.NOT.snoozes.some.snoozedUntil.gt).toBeInstanceOf(Date);
    });

    it('OWNER role bypasses snooze exclusion (sees everything)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        userId: 'owner-1',
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      const ands = (callArg.where.AND ?? []) as any[];
      const snoozeClause = ands.find((c) => c?.NOT?.snoozes);
      expect(snoozeClause).toBeUndefined();
    });

    it('does not apply snooze exclusion when userId missing (e.g., system queries)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({
        tab: 'today',
        userRole: 'SALES',
        userBranchId: 'branch-1',
      });

      const callArg = mockPrisma.contract.findMany.mock.calls[0][0];
      const ands = (callArg.where.AND ?? []) as any[];
      const snoozeClause = ands.find((c) => c?.NOT?.snoozes);
      expect(snoozeClause).toBeUndefined();
    });

    it('minLetterCount=0 includes all contracts (no letters filter)', async () => {
      const a = makeContractWithDays('a', 10);
      const b = makeContractWithDays('b', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([a, b]);
      mockPrisma.contract.count.mockResolvedValueOnce(2);
      mockPrisma.contractLetter.groupBy.mockResolvedValueOnce([
        { contractId: 'a', _count: { _all: 0 } },
      ]);

      const result = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        minLetterCount: 0,
      });

      expect(result.data.map((r) => r.id).sort()).toEqual(['a', 'b']);
    });
  });

  describe('sortBy', () => {
    function makeQueueRows() {
      // 3 contracts with distinct outstanding/daysOverdue/name to disambiguate sort
      return [
        makeContract({
          id: 'c1',
          contractNumber: 'BC-1',
          customer: { id: 'cu1', name: 'ก สมชาย', phone: '0811111111', lineIdFinance: null },
          payments: [
            {
              amountDue: '1000.00',
              amountPaid: '0.00',
              lateFee: '0.00',
              dueDate: new Date(Date.now() - 5 * 86400000),
              status: 'OVERDUE',
            },
          ],
        }),
        makeContract({
          id: 'c2',
          contractNumber: 'BC-2',
          customer: { id: 'cu2', name: 'ค สมหญิง', phone: '0822222222', lineIdFinance: null },
          payments: [
            {
              amountDue: '5000.00',
              amountPaid: '0.00',
              lateFee: '0.00',
              dueDate: new Date(Date.now() - 30 * 86400000),
              status: 'OVERDUE',
            },
          ],
        }),
        makeContract({
          id: 'c3',
          contractNumber: 'BC-3',
          customer: { id: 'cu3', name: 'ข สมพร', phone: '0833333333', lineIdFinance: null },
          payments: [
            {
              amountDue: '3000.00',
              amountPaid: '0.00',
              lateFee: '0.00',
              dueDate: new Date(Date.now() - 15 * 86400000),
              status: 'OVERDUE',
            },
          ],
        }),
      ];
    }

    it('outstanding_desc returns highest-outstanding first', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce(makeQueueRows());
      mockPrisma.contract.count.mockResolvedValueOnce(3);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
        sortBy: 'outstanding_desc' as any,
      });
      expect(r.data.map((row) => row.id)).toEqual(['c2', 'c3', 'c1']);
    });

    it('outstanding_asc returns lowest-outstanding first', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce(makeQueueRows());
      mockPrisma.contract.count.mockResolvedValueOnce(3);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
        sortBy: 'outstanding_asc' as any,
      });
      expect(r.data.map((row) => row.id)).toEqual(['c1', 'c3', 'c2']);
    });

    it('days_overdue_desc returns oldest-overdue first', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce(makeQueueRows());
      mockPrisma.contract.count.mockResolvedValueOnce(3);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
        sortBy: 'days_overdue_desc' as any,
      });
      expect(r.data.map((row) => row.id)).toEqual(['c2', 'c3', 'c1']);
    });

    it('name_asc sorts by Thai customer name', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce(makeQueueRows());
      mockPrisma.contract.count.mockResolvedValueOnce(3);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
        sortBy: 'name_asc' as any,
      });
      // ก < ข < ค in Thai locale collation
      expect(r.data.map((row) => row.id)).toEqual(['c1', 'c3', 'c2']);
    });

    it('random produces deterministic order for same userId+today', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce(makeQueueRows());
      mockPrisma.contract.count.mockResolvedValueOnce(3);

      const a = await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
        userId: 'user-X',
        sortBy: 'random' as any,
      });

      mockPrisma.contract.findMany.mockResolvedValueOnce(makeQueueRows());
      mockPrisma.contract.count.mockResolvedValueOnce(3);
      const b = await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
        userId: 'user-X',
        sortBy: 'random' as any,
      });

      expect(a.data.map((r) => r.id)).toEqual(b.data.map((r) => r.id));
      // result is a permutation of inputs
      expect([...a.data.map((r) => r.id)].sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('default (priority) preserves legacy behavior', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce(makeQueueRows());
      mockPrisma.contract.count.mockResolvedValueOnce(3);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'BRANCH_MANAGER',
        userBranchId: 'branch-1',
      });
      // c2 has highest outstanding × daysOverdue → priority leader
      expect(r.data[0].id).toBe('c2');
    });
  });

  describe('trendingArrow (Task 10)', () => {
    function makeContractWithDaysOverdue(id: string, days: number): any {
      return {
        id,
        contractNumber: `BC-${id}`,
        status: 'OVERDUE',
        dunningStage: 'NONE',
        customerId: `cu-${id}`,
        noAnswerCount: 0,
        needsSkipTracing: false,
        deviceLocked: false,
        customer: { id: `cu-${id}`, name: id, phone: '0', lineIdFinance: null },
        branch: { id: 'b', name: 'b' },
        assignedTo: null,
        payments: [
          {
            amountDue: '5000',
            amountPaid: '0',
            lateFee: '0',
            dueDate: new Date(Date.now() - days * 86400000),
            status: 'OVERDUE',
          },
        ],
        callLogs: [],
        _count: { callLogs: 0 },
      };
    }

    it("renders 'UP' when today's daysOverdue exceeds the 7-day-ago snapshot", async () => {
      const c = makeContractWithDaysOverdue('worse', 15); // today: ~15 days
      mockPrisma.contract.findMany.mockResolvedValueOnce([c]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.contractDailySnapshot.findMany.mockResolvedValueOnce([
        { contractId: 'worse', daysOverdue: 8 }, // 7 days ago they were behind 8
      ]);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(r.data[0].trendingArrow).toBe('UP');
    });

    it("renders 'DOWN' when today's daysOverdue is less than the snapshot", async () => {
      const c = makeContractWithDaysOverdue('better', 5);
      mockPrisma.contract.findMany.mockResolvedValueOnce([c]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.contractDailySnapshot.findMany.mockResolvedValueOnce([
        { contractId: 'better', daysOverdue: 12 },
      ]);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(r.data[0].trendingArrow).toBe('DOWN');
    });

    it('renders null when delta is exactly zero (no change)', async () => {
      const c = makeContractWithDaysOverdue('same', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([c]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.contractDailySnapshot.findMany.mockResolvedValueOnce([
        { contractId: 'same', daysOverdue: 10 },
      ]);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(r.data[0].trendingArrow).toBeNull();
    });

    it('renders null when no historical snapshot exists for this contract', async () => {
      const c = makeContractWithDaysOverdue('new', 10);
      mockPrisma.contract.findMany.mockResolvedValueOnce([c]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.contractDailySnapshot.findMany.mockResolvedValueOnce([]); // no row

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      expect(r.data[0].trendingArrow).toBeNull();
    });

    it('queries snapshots in a ±1 day window around 7-days-ago (cron-skip tolerance)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        makeContractWithDaysOverdue('a', 5),
      ]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);

      await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
      });

      const snapCall = mockPrisma.contractDailySnapshot.findMany.mock.calls[0][0];
      expect(snapCall.distinct).toEqual(['contractId']);
      const lo = snapCall.where.date.gte as Date;
      const hi = snapCall.where.date.lte as Date;
      // Window spans (7+1)d ago → (7-1)d ago = 8d → 6d ago
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const expectedLo = today.getTime() - 8 * 86400000;
      const expectedHi = today.getTime() - 6 * 86400000;
      expect(Math.abs(lo.getTime() - expectedLo)).toBeLessThan(86400000);
      expect(Math.abs(hi.getTime() - expectedHi)).toBeLessThan(86400000);
    });

    it('OWNER receives snoozedUntil for contracts they have an active snooze on', async () => {
      const c = makeContractWithDaysOverdue('snzd', 10);
      const future = new Date(Date.now() + 3600 * 1000);
      mockPrisma.contract.findMany.mockResolvedValueOnce([c]);
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.contractSnooze.findMany.mockResolvedValueOnce([
        { contractId: 'snzd', snoozedUntil: future },
      ]);

      const r = await service.getQueue({
        tab: 'today',
        userRole: 'OWNER',
        userBranchId: null,
        userId: 'owner-1',
      });

      expect(r.data[0].snoozedUntil).toEqual(future);
    });
  });
});
