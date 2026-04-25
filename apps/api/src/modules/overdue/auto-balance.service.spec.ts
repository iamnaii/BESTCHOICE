import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoBalanceService } from './auto-balance.service';

const COLLECTOR_ROLES = ['SALES', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'OWNER'];

const mockPrisma = {
  contract: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  contractSnooze: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
  auditLog: {
    createMany: jest.fn(),
  },
};

describe('AutoBalanceService — P3 Task 2 exclusions', () => {
  let service: AutoBalanceService;
  const NOW = new Date('2026-04-25T10:00:00.000Z');

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'user-A', name: 'A', role: 'SALES' },
      { id: 'user-B', name: 'B', role: 'SALES' },
    ]);
    mockPrisma.contractSnooze.findMany.mockResolvedValue([]);
    mockPrisma.contract.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    );
    mockPrisma.auditLog.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(async (fn: any) =>
      typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn),
    );

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AutoBalanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = mod.get(AutoBalanceService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('preview', () => {
    it('returns zero exclusions when no contracts match exclusion rules', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        {
          id: 'c1',
          status: 'OVERDUE',
          assignedToId: 'user-A',
          assignedAt: new Date('2026-04-01T00:00:00.000Z'), // > 24h old
        },
        {
          id: 'c2',
          status: 'OVERDUE',
          assignedToId: null,
          assignedAt: null,
        },
      ]);

      const preview = await service.preview();
      expect(preview.totalContracts).toBe(2);
      expect(preview.eligibleCount).toBe(2);
      expect(preview.excludedSnooze).toBe(0);
      expect(preview.excludedLegal).toBe(0);
      expect(preview.excludedRecentlyAssigned).toBe(0);
      expect(preview.collectorCount).toBe(2);
    });

    it('excludes contracts with status = LEGAL', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        { id: 'c1', status: 'OVERDUE', assignedToId: null, assignedAt: null },
        { id: 'c2', status: 'LEGAL', assignedToId: null, assignedAt: null },
        { id: 'c3', status: 'LEGAL', assignedToId: 'user-A', assignedAt: null },
      ]);

      const preview = await service.preview();
      expect(preview.totalContracts).toBe(3);
      expect(preview.excludedLegal).toBe(2);
      expect(preview.eligibleCount).toBe(1);
    });

    it('excludes contracts re-assigned within last 24h', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        {
          id: 'c1',
          status: 'OVERDUE',
          assignedToId: 'user-A',
          assignedAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h ago
        },
        {
          id: 'c2',
          status: 'OVERDUE',
          assignedToId: 'user-B',
          assignedAt: new Date(NOW.getTime() - 23 * 60 * 60 * 1000), // 23h ago
        },
        {
          id: 'c3',
          status: 'OVERDUE',
          assignedToId: 'user-A',
          assignedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000), // 25h ago — eligible
        },
      ]);

      const preview = await service.preview();
      expect(preview.excludedRecentlyAssigned).toBe(2);
      expect(preview.eligibleCount).toBe(1);
    });

    it('excludes contracts with active snooze for the previous assignee', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        {
          id: 'c1',
          status: 'OVERDUE',
          assignedToId: 'user-A',
          assignedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
        {
          id: 'c2',
          status: 'OVERDUE',
          assignedToId: 'user-B',
          assignedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      ]);
      // user-A snoozed c1 until tomorrow → exclude c1
      mockPrisma.contractSnooze.findMany.mockResolvedValue([
        {
          contractId: 'c1',
          userId: 'user-A',
          snoozedUntil: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
        },
      ]);

      const preview = await service.preview();
      expect(preview.excludedSnooze).toBe(1);
      expect(preview.eligibleCount).toBe(1);
    });

    it('does not exclude when snooze belongs to a different (not previous) user', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        {
          id: 'c1',
          status: 'OVERDUE',
          assignedToId: 'user-A',
          assignedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      ]);
      // user-B snoozed it but the prev assignee is user-A → DO NOT exclude
      mockPrisma.contractSnooze.findMany.mockResolvedValue([
        {
          contractId: 'c1',
          userId: 'user-B',
          snoozedUntil: new Date(NOW.getTime() + 60 * 60 * 1000),
        },
      ]);

      const preview = await service.preview();
      expect(preview.excludedSnooze).toBe(0);
      expect(preview.eligibleCount).toBe(1);
    });

    it('counts each contract under only one exclusion bucket (LEGAL > snooze > recent)', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        {
          id: 'c1',
          status: 'LEGAL',
          assignedToId: 'user-A',
          assignedAt: new Date(NOW.getTime() - 1 * 60 * 60 * 1000), // also recent
        },
      ]);
      mockPrisma.contractSnooze.findMany.mockResolvedValue([
        {
          contractId: 'c1',
          userId: 'user-A',
          snoozedUntil: new Date(NOW.getTime() + 60 * 60 * 1000),
        },
      ]);

      const preview = await service.preview();
      expect(preview.excludedLegal).toBe(1);
      expect(preview.excludedSnooze).toBe(0);
      expect(preview.excludedRecentlyAssigned).toBe(0);
      expect(preview.eligibleCount).toBe(0);
    });
  });

  describe('execute', () => {
    it('throws BadRequest when there are no collectors', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.contract.findMany.mockResolvedValue([
        { id: 'c1', status: 'OVERDUE', assignedToId: null, assignedAt: null },
      ]);
      await expect(service.execute('owner-1')).rejects.toThrow(BadRequestException);
    });

    it('round-robin distributes only ELIGIBLE contracts and bumps assignedAt', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        { id: 'c1', status: 'OVERDUE', assignedToId: null, assignedAt: null },
        { id: 'c2', status: 'OVERDUE', assignedToId: null, assignedAt: null },
        { id: 'c3', status: 'LEGAL', assignedToId: null, assignedAt: null }, // excluded
        {
          id: 'c4',
          status: 'OVERDUE',
          assignedToId: 'user-A',
          assignedAt: new Date(NOW.getTime() - 60 * 60 * 1000), // recent → excluded
        },
      ]);

      const result = await service.execute('owner-1');
      expect(result.assigned).toBe(2);
      expect(result.excludedLegal).toBe(1);
      expect(result.excludedRecentlyAssigned).toBe(1);

      // Verify only c1 + c2 got updated
      const updateCalls = mockPrisma.contract.update.mock.calls.map((c: any) => c[0]);
      const updatedIds = updateCalls.map((u: any) => u.where.id).sort();
      expect(updatedIds).toEqual(['c1', 'c2']);
      // Each update must set assignedAt
      for (const u of updateCalls) {
        expect(u.data.assignedAt).toBeInstanceOf(Date);
        expect(u.data.assignedToId).toBeDefined();
      }
    });
  });
});
