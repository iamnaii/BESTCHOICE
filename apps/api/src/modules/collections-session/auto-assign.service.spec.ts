import { Test, TestingModule } from '@nestjs/testing';
import { AutoAssignService } from './auto-assign.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AutoAssignService', () => {
  let service: AutoAssignService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      contract: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
      dailyAssignment: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      contractDailySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    prismaMock.$transaction = jest.fn().mockImplementation((cb: any) => cb(prismaMock));

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AutoAssignService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(AutoAssignService);
    prisma = moduleRef.get(PrismaService);
  });

  // Helper: stub snapshot + audit data sourced from inline contract objects
  // so existing test cases keep their declarative shape without each test
  // having to mock 2 extra queries.
  function seedDerived(rows: Array<{ id: string; daysOverdue?: number; brokenPromiseCount?: number }>) {
    prisma.contractDailySnapshot.findMany.mockResolvedValue(
      rows.map((r) => ({ contractId: r.id, daysOverdue: r.daysOverdue ?? 0 })),
    );
    prisma.auditLog.groupBy.mockResolvedValue(
      rows
        .filter((r) => (r.brokenPromiseCount ?? 0) > 0)
        .map((r) => ({ entityId: r.id, _count: { _all: r.brokenPromiseCount! } })),
    );
  }

  it('keeps relationship when contract.assignedTo points to active collector', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: 'u1', branchId: 'br1' } as any,
    ]);
    seedDerived([{ id: 'c1', daysOverdue: 10 }]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(new Date('2026-04-26'));

    expect(prisma.dailyAssignment.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          contractId: 'c1',
          collectorId: 'u1',
          source: 'AUTO_RELATIONSHIP',
        }),
      ]),
    });
  });

  it('falls back to branch lowest-workload when no prior relationship', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: null, branchId: 'br1' } as any,
      { id: 'c2', assignedToId: null, branchId: 'br1' } as any,
      { id: 'c3', assignedToId: null, branchId: 'br1' } as any,
    ]);
    seedDerived([
      { id: 'c1', daysOverdue: 5 },
      { id: 'c2', daysOverdue: 5 },
      { id: 'c3', daysOverdue: 5 },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br1' } as any,
      { id: 'u2', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(new Date('2026-04-26'));

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    const u1Count = created.filter((r: any) => r.collectorId === 'u1').length;
    const u2Count = created.filter((r: any) => r.collectorId === 'u2').length;
    expect(Math.abs(u1Count - u2Count)).toBeLessThanOrEqual(1);
    expect(created.every((r: any) => r.source === 'AUTO_BRANCH')).toBe(true);
  });

  it('round-robins when no same-branch collector exists', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: null, branchId: 'br_unknown' } as any,
      { id: 'c2', assignedToId: null, branchId: 'br_unknown' } as any,
    ]);
    seedDerived([
      { id: 'c1', daysOverdue: 5 },
      { id: 'c2', daysOverdue: 5 },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br_other' } as any,
      { id: 'u2', collectionsActive: true, branchId: 'br_other' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(new Date('2026-04-26'));

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    expect(created).toHaveLength(2);
    expect(new Set(created.map((r: any) => r.collectorId))).toEqual(new Set(['u1', 'u2']));
    expect(created.every((r: any) => r.source === 'AUTO_ROUNDROBIN')).toBe(true);
  });

  it('marks 90+ days with broken promises as escalation (no collector)', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: 'u1', branchId: 'br1' } as any,
    ]);
    seedDerived([{ id: 'c1', daysOverdue: 95, brokenPromiseCount: 3 }]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(new Date('2026-04-26'));

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    expect(created[0]).toMatchObject({
      contractId: 'c1',
      collectorId: null,
      escalationFlag: true,
    });
  });

  it('caps at 30 contracts per collector — overflow to pool', async () => {
    const contracts = Array.from({ length: 35 }, (_, i) => ({
      id: `c${i}`,
      assignedToId: 'u1',
      branchId: 'br1',
    }));
    prisma.contract.findMany.mockResolvedValue(contracts as any);
    seedDerived(contracts.map((c) => ({ id: c.id, daysOverdue: 5 })));
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(new Date('2026-04-26'));

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    const u1Count = created.filter((r: any) => r.collectorId === 'u1').length;
    const poolCount = created.filter((r: any) => r.collectorId === null).length;
    expect(u1Count).toBe(30);
    expect(poolCount).toBe(5);
  });

  it('skips collectors that are not collectionsActive', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: 'u1', branchId: 'br1' } as any,
    ]);
    seedDerived([{ id: 'c1', daysOverdue: 5 }]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u2', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(new Date('2026-04-26'));

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    expect(created[0].collectorId).toBe('u2');
    expect(created[0].source).toBe('AUTO_BRANCH');
  });
});
