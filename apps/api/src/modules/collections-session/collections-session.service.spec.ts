import { Test } from '@nestjs/testing';
import { CollectionsSessionService } from './collections-session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('CollectionsSessionService', () => {
  let service: CollectionsSessionService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      dailyAssignment: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      contractDailySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CollectionsSessionService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(CollectionsSessionService);
    prisma = moduleRef.get(PrismaService);
  });

  it('returns ordered session list with breakdown', async () => {
    prisma.dailyAssignment.findMany.mockResolvedValue([
      {
        id: 'a1', contractId: 'c1', escalationFlag: false, position: 0, status: 'PENDING',
        contract: { customer: { phone: '08x' } },
      },
      {
        id: 'a2', contractId: 'c2', escalationFlag: false, position: 1, status: 'PENDING',
        contract: { customer: { phone: '08y' } },
      },
    ]);
    prisma.contractDailySnapshot.findMany.mockResolvedValue([
      { contractId: 'c1', daysOverdue: 95 },
      { contractId: 'c2', daysOverdue: 5 },
    ]);

    const result = await service.getMySession('u1');

    expect(result.contracts).toHaveLength(2);
    expect(result.target.count).toBe(2);
    expect(result.breakdown.severe).toBe(1);
    expect(result.breakdown.light).toBe(1);
    expect(result.summary).toBeUndefined();
  });

  it('records action and advances to next contract', async () => {
    prisma.dailyAssignment.findFirst
      .mockResolvedValueOnce({ id: 'a1', collectorId: 'u1', status: 'PENDING', date: new Date('2026-04-26') })
      .mockResolvedValueOnce({ id: 'a2', collectorId: 'u1', status: 'PENDING', contractId: 'c2' });
    prisma.dailyAssignment.update.mockResolvedValue({});

    const result = await service.recordAction('a1', 'u1', { outcome: 'CALL_CONNECTED' as any });

    expect(prisma.dailyAssignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        outcome: 'CALL_CONNECTED',
        status: 'DONE',
        completedAt: expect.any(Date),
      }),
    });
    expect(result.nextContractId).toBe('c2');
  });

  it('throws NotFound when assignment not owned by user', async () => {
    prisma.dailyAssignment.findFirst.mockResolvedValue(null);
    await expect(
      service.recordAction('a1', 'u1', { outcome: 'CALL_CONNECTED' as any }),
    ).rejects.toThrow(NotFoundException);
  });

  it('skip with WRONG_QUEUE returns to pool (collectorId=null, status stays PENDING)', async () => {
    prisma.dailyAssignment.findFirst
      .mockResolvedValueOnce({ id: 'a1', collectorId: 'u1', status: 'PENDING', date: new Date() })
      .mockResolvedValueOnce(null);
    prisma.dailyAssignment.update.mockResolvedValue({});

    await service.skip('a1', 'u1', { reason: 'WRONG_QUEUE' as any });

    expect(prisma.dailyAssignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        collectorId: null,
        status: 'PENDING',
      }),
    });
  });

  it('skip with BUSY marks SKIPPED with completedAt', async () => {
    prisma.dailyAssignment.findFirst
      .mockResolvedValueOnce({ id: 'a1', collectorId: 'u1', status: 'PENDING', date: new Date() })
      .mockResolvedValueOnce(null);
    prisma.dailyAssignment.update.mockResolvedValue({});

    await service.skip('a1', 'u1', { reason: 'BUSY' as any });

    expect(prisma.dailyAssignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        status: 'SKIPPED',
        completedAt: expect.any(Date),
      }),
    });
  });
});
