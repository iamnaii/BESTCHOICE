import { Test } from '@nestjs/testing';
import { PoolService } from './pool.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ConflictException } from '@nestjs/common';

describe('PoolService', () => {
  let service: PoolService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      dailyAssignment: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const settingsMock = {
      getCollectionsConfig: jest.fn().mockResolvedValue({
        dailyCap: 30,
        workloadFloor: 10,
        etaPerContractMin: 5,
        sessionTargetMin: 150,
        selfClaimLockHours: 2,
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PoolService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SettingsService, useValue: settingsMock },
      ],
    }).compile();
    service = moduleRef.get(PoolService);
    prisma = moduleRef.get(PrismaService);
  });

  it('claims an unassigned contract from pool', async () => {
    prisma.dailyAssignment.findFirst.mockResolvedValue({
      id: 'a1',
      collectorId: null,
      contractId: 'c1',
      status: 'PENDING',
    });
    prisma.dailyAssignment.update.mockResolvedValue({});

    await service.claim('a1', 'u1');

    expect(prisma.dailyAssignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        collectorId: 'u1',
        source: 'SELF_CLAIMED',
        lockedAt: expect.any(Date),
        lockExpiresAt: expect.any(Date),
      }),
    });
  });

  it('throws ConflictException when contract already claimed', async () => {
    prisma.dailyAssignment.findFirst.mockResolvedValue(null);
    await expect(service.claim('a1', 'u1')).rejects.toThrow(ConflictException);
  });

  it('list filters by branch when branchId provided', async () => {
    prisma.dailyAssignment.findMany.mockResolvedValue([]);
    await service.list('br1');
    const call = prisma.dailyAssignment.findMany.mock.calls[0][0];
    expect(call.where.contract).toEqual({ branchId: 'br1' });
  });

  it('list returns all pool items when no branchId', async () => {
    prisma.dailyAssignment.findMany.mockResolvedValue([]);
    await service.list();
    const call = prisma.dailyAssignment.findMany.mock.calls[0][0];
    expect(call.where.contract).toBeUndefined();
  });
});
