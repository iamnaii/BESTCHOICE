import { Test } from '@nestjs/testing';
import { CollectionsManageService } from './collections-manage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoAssignService } from '../collections-session/auto-assign.service';

describe('CollectionsManageService', () => {
  let service: CollectionsManageService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      dailyAssignment: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      user: { findMany: jest.fn() },
      contractDailySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CollectionsManageService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AutoAssignService, useValue: { runForDate: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CollectionsManageService);
    prisma = moduleRef.get(PrismaService);
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
});
