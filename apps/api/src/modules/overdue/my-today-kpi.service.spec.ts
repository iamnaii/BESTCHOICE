import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MyTodayKpiService } from './my-today-kpi.service';

const mockPrisma = {
  callLog: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  dunningAction: {
    count: jest.fn(),
  },
  payment: {
    aggregate: jest.fn(),
    findFirst: jest.fn(),
  },
};

describe('MyTodayKpiService', () => {
  let service: MyTodayKpiService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no rows
    mockPrisma.callLog.count.mockResolvedValue(0);
    mockPrisma.dunningAction.count.mockResolvedValue(0);
    mockPrisma.callLog.findMany.mockResolvedValue([]);
    mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: null } });
    mockPrisma.payment.findFirst.mockResolvedValue(null);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        MyTodayKpiService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = mod.get(MyTodayKpiService);
  });

  describe('getMyToday', () => {
    it('returns zero counts and "0.00" baht when no activity', async () => {
      const out = await service.getMyToday('user-1');
      expect(out).toEqual({
        callsToday: 0,
        callsTarget: 20,
        lineSentToday: 0,
        promisesKeptToday: 0,
        collectedTodayBaht: '0.00',
      });
    });

    it('returns the default 20 calls target', async () => {
      const out = await service.getMyToday('user-1');
      expect(out.callsTarget).toBe(20);
    });

    it('counts calls scoped to the caller (callerId=self) since start of Bangkok day', async () => {
      mockPrisma.callLog.count.mockResolvedValueOnce(7); // calls
      const out = await service.getMyToday('user-42');
      expect(out.callsToday).toBe(7);
      // First call.count() invocation = callsToday query
      const args = mockPrisma.callLog.count.mock.calls[0][0];
      expect(args.where.callerId).toBe('user-42');
      expect(args.where.deletedAt).toBeNull();
      expect(args.where.calledAt.gte).toBeInstanceOf(Date);
      // Bangkok start-of-day must be a valid Date in the past or now
      expect((args.where.calledAt.gte as Date).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('counts LINE messages from DunningAction with executedById=self and channel=LINE', async () => {
      mockPrisma.dunningAction.count.mockResolvedValueOnce(4);
      const out = await service.getMyToday('user-9');
      expect(out.lineSentToday).toBe(4);
      const args = mockPrisma.dunningAction.count.mock.calls[0][0];
      expect(args.where.channel).toBe('LINE');
      expect(args.where.executedById).toBe('user-9');
      expect(args.where.deletedAt).toBeNull();
    });

    it('sums paid Payment.amountPaid where recordedById=self and returns Decimal-precise string', async () => {
      mockPrisma.payment.aggregate.mockResolvedValueOnce({
        _sum: { amountPaid: new Prisma.Decimal('12345.67') },
      });
      const out = await service.getMyToday('user-1');
      expect(out.collectedTodayBaht).toBe('12345.67');
      const args = mockPrisma.payment.aggregate.mock.calls[0][0];
      expect(args.where.recordedById).toBe('user-1');
      expect(args.where.status).toBe('PAID');
    });

    it('counts a kept promise when a PAID Payment exists on/after the settlementDate', async () => {
      const settlement = new Date(Date.now() + 60 * 60 * 1000); // later today
      mockPrisma.callLog.findMany.mockResolvedValueOnce([
        { contractId: 'c-1', settlementDate: settlement },
        { contractId: 'c-2', settlementDate: settlement },
      ]);
      // c-1 paid, c-2 not paid
      mockPrisma.payment.findFirst
        .mockResolvedValueOnce({ id: 'p-1' })
        .mockResolvedValueOnce(null);

      const out = await service.getMyToday('user-1');
      expect(out.promisesKeptToday).toBe(1);
      // findMany filter scoped to the caller and PROMISED
      const findArgs = mockPrisma.callLog.findMany.mock.calls[0][0];
      expect(findArgs.where.callerId).toBe('user-1');
      expect(findArgs.where.result).toBe('PROMISED');
    });

    it('skips kept-promise lookups entirely when no candidates exist', async () => {
      mockPrisma.callLog.findMany.mockResolvedValueOnce([]);
      const out = await service.getMyToday('user-1');
      expect(out.promisesKeptToday).toBe(0);
      expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
    });

    it('ignores promise candidates with a null settlementDate (defensive)', async () => {
      mockPrisma.callLog.findMany.mockResolvedValueOnce([
        { contractId: 'c-bad', settlementDate: null },
      ]);
      const out = await service.getMyToday('user-1');
      expect(out.promisesKeptToday).toBe(0);
      expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
    });
  });
});
