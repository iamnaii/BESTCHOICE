import { Test } from '@nestjs/testing';
import { CollectionsManageService } from './collections-manage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoAssignService } from '../collections-session/auto-assign.service';
import { LineOaService } from '../line-oa/line-oa.service';

describe('CollectionsManageService', () => {
  let service: CollectionsManageService;
  let prisma: any;
  let line: any;

  beforeEach(async () => {
    const prismaMock: any = {
      dailyAssignment: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn(),
      },
      user: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
      contractDailySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { count: jest.fn() },
      auditLog: { groupBy: jest.fn() },
    };
    const lineMock = { pushMessage: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CollectionsManageService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AutoAssignService, useValue: { runForDate: jest.fn() } },
        { provide: LineOaService, useValue: lineMock },
      ],
    }).compile();
    service = moduleRef.get(CollectionsManageService);
    prisma = moduleRef.get(PrismaService);
    line = moduleRef.get(LineOaService);
  });

  it('transfers N pending contracts oldest-first', async () => {
    prisma.dailyAssignment.findMany.mockResolvedValue([
      { id: 'a1' }, { id: 'a2' }, { id: 'a3' },
    ]);
    prisma.dailyAssignment.updateMany.mockResolvedValue({ count: 3 });

    const result = await service.transfer({
      fromCollectorId: 'u1',
      toCollectorId: 'u2',
      count: 3,
    });

    expect(result.moved).toBe(3);
    expect(prisma.dailyAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2', 'a3'] } },
      data: { collectorId: 'u2', source: 'MANAGER_OVERRIDE' },
    });
  });

  it('returns 0 when from-collector has no pending', async () => {
    prisma.dailyAssignment.findMany.mockResolvedValue([]);
    const result = await service.transfer({
      fromCollectorId: 'u1',
      toCollectorId: 'u2',
      count: 5,
    });
    expect(result.moved).toBe(0);
  });

  it('closeSession moves pending to pool', async () => {
    prisma.dailyAssignment.updateMany.mockResolvedValue({ count: 5 });
    await service.closeSession('u1');
    expect(prisma.dailyAssignment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ collectorId: 'u1', status: 'PENDING' }),
      data: { collectorId: null, source: 'MANAGER_OVERRIDE' },
    });
  });

  it('assignContract throws NotFound when assignment missing', async () => {
    prisma.dailyAssignment.findUnique.mockResolvedValue(null);
    await expect(service.assignContract('missing', 'u1')).rejects.toThrow();
  });

  it('transfer notifies both collectors when there is a lock today', async () => {
    prisma.dailyAssignment.findFirst.mockResolvedValue({ id: 'lock-row' });
    prisma.dailyAssignment.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    prisma.dailyAssignment.updateMany.mockResolvedValue({ count: 2 });
    prisma.user.findUnique
      .mockResolvedValueOnce({ lineId: 'L_FROM' })
      .mockResolvedValueOnce({ lineId: 'L_TO' });

    await service.transfer({
      fromCollectorId: 'u1',
      toCollectorId: 'u2',
      count: 2,
    });

    expect(line.pushMessage).toHaveBeenCalledTimes(2);
    expect(line.pushMessage).toHaveBeenCalledWith('L_FROM', expect.any(Array));
    expect(line.pushMessage).toHaveBeenCalledWith('L_TO', expect.any(Array));
  });

  it('transfer does NOT notify when no lock today (still in planning window)', async () => {
    prisma.dailyAssignment.findFirst.mockResolvedValue(null);
    prisma.dailyAssignment.findMany.mockResolvedValue([{ id: 'a1' }]);
    prisma.dailyAssignment.updateMany.mockResolvedValue({ count: 1 });

    await service.transfer({
      fromCollectorId: 'u1',
      toCollectorId: 'u2',
      count: 1,
    });

    expect(line.pushMessage).not.toHaveBeenCalled();
  });

  it('getOverview returns counts + suggestedPerCollector', async () => {
    prisma.contract.count.mockResolvedValue(124);
    prisma.contractDailySnapshot.findMany.mockResolvedValue([
      { contractId: 'c1', daysOverdue: 95 },
      { contractId: 'c2', daysOverdue: 100 },
    ]);
    prisma.auditLog.groupBy.mockResolvedValue([
      { entityId: 'c1', _count: { _all: 3 } },
      { entityId: 'c2', _count: { _all: 1 } },
    ]);
    prisma.user.count.mockResolvedValue(3);
    prisma.dailyAssignment.count.mockResolvedValue(0);
    prisma.dailyAssignment.findFirst.mockResolvedValue(null);

    const result = await service.getOverview();

    expect(result).toMatchObject({
      totalOverdue: 124,
      escalationCount: 1, // c1 only (c2 has 1 broken promise, < 2)
      activeCollectors: 3,
      todayAssignmentCount: 0,
      lockedAt: null,
      suggestedPerCollector: 42, // ceil(124/3)
    });
  });
});
