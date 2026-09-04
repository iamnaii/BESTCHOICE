import { ContractStatus, UserRole } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AutoAssignService } from './auto-assign.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

describe('AutoAssignService', () => {
  let service: AutoAssignService;
  let prisma: any;
  let settings: any;

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

    const settingsMock = {
      getCollectionsConfig: jest.fn().mockResolvedValue({
        dailyCap: 30,
        workloadFloor: 10,
        etaPerContractMin: 5,
        sessionTargetMin: 150,
        selfClaimLockHours: 2,
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AutoAssignService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SettingsService, useValue: settingsMock },
      ],
    }).compile();
    service = moduleRef.get(AutoAssignService);
    prisma = moduleRef.get(PrismaService);
    settings = moduleRef.get(SettingsService);
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

  // เทสชุดนี้มีขึ้นเพราะบั๊กจริง: query เคยเขียน `['OVERDUE', 'PENDING'] as any`
  // ซึ่ง ContractStatus ไม่มีค่า PENDING — `as any` ทำให้ tsc ปล่อยผ่าน แล้ว Prisma
  // โยน validation error ตอน runtime ⇒ cron พังเงียบ 9 คืนติดกัน
  // เทสเดิมทุกตัว mock prisma ไว้ จึงไม่มีทางเห็นว่าค่าที่ส่งไปไม่มีอยู่จริงใน enum
  describe('ค่าที่ส่งให้ Prisma ต้องมีอยู่จริงใน enum', () => {
    async function captureQueries() {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.dailyAssignment.findMany.mockResolvedValue([]);
      await service.runForDate(new Date('2026-04-26'));
      return {
        contractWhere: prisma.contract.findMany.mock.calls[0][0].where,
        userWhere: prisma.user.findMany.mock.calls[0][0].where,
      };
    }

    it('สถานะสัญญาที่ใช้กรองต้องเป็นค่าใน ContractStatus ทุกตัว', async () => {
      const { contractWhere } = await captureQueries();
      const statuses: string[] = contractWhere.status.in;

      expect(statuses.length).toBeGreaterThan(0);
      const valid = Object.values(ContractStatus) as string[];
      const invalid = statuses.filter((s) => !valid.includes(s));
      expect(invalid).toEqual([]);
      // ปักไว้ตรง ๆ ว่าค่าที่เคยพังต้องไม่กลับมา
      expect(statuses).not.toContain('PENDING');
      expect(statuses).toContain(ContractStatus.OVERDUE);
    });

    it('role ของพนักงานติดตามต้องเป็นค่าใน UserRole', async () => {
      const { userWhere } = await captureQueries();
      expect(Object.values(UserRole) as string[]).toContain(userWhere.role);
    });
  });

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

  it('cap respects dailyCap from settings', async () => {
    settings.getCollectionsConfig.mockResolvedValueOnce({
      dailyCap: 5,
      workloadFloor: 2,
      etaPerContractMin: 5,
      sessionTargetMin: 150,
      selfClaimLockHours: 2,
    });
    const contracts = Array.from({ length: 8 }, (_, i) => ({
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
    expect(u1Count).toBe(5);
    expect(poolCount).toBe(3);
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
