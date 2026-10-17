import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { EmployeeAccessService } from './employee-access.service';
import { AccessSnapshotService } from './access-snapshot.service';

describe('employee access persistence boundary', () => {
  let db: any;
  let service: EmployeeAccessService;
  beforeEach(() => {
    db = {
      $executeRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'actor',
          role: 'OWNER',
          isActive: true,
          isSystemUser: false,
          deletedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      accessPosition: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employeeAccessAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ companyCode: 'SHOP' }) },
      branch: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
    };
    db.$transaction = (fn: any) => fn(db);
    service = new EmployeeAccessService(db, new AccessSnapshotService(db));
  });
  it('denies a non-owner even when a position is named OWNER', async () => {
    db.user.findUnique.mockResolvedValue({
      role: 'SALES',
      isActive: true,
      accessAssignments: [{ position: { code: 'OWNER' } }],
    });
    await expect(
      service.createPosition('actor', { code: 'TEST', name: 'ทดสอบ', permissions: [] }),
    ).rejects.toThrow(ForbiddenException);
    expect(db.accessPosition.create).not.toHaveBeenCalled();
  });
  it.each(['unknown.permission', 'positions.manage', 'activity.read'])(
    'rejects unassignable permission %s',
    async (permission) => {
      await expect(
        service.createPosition('actor', { code: 'TEST', name: 'ทดสอบ', permissions: [permission] }),
      ).rejects.toThrow(BadRequestException);
    },
  );
  it('rejects creating a position with reserved OWNER code', async () => {
    await expect(
      service.createPosition('actor', { code: 'OWNER', name: 'เจ้าของ', permissions: [] }),
    ).rejects.toThrow(BadRequestException);
  });
  it('rejects a stale position revision before mutation', async () => {
    db.accessPosition.findUnique.mockResolvedValue({ id: 'p', revision: 2, deletedAt: null });
    await expect(
      service.updatePosition('actor', 'p', { expectedRevision: 1, name: 'ใหม่' }),
    ).rejects.toThrow(ConflictException);
    expect(db.accessPosition.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    { company: 'OTHER', scope: 'COMPANY', branchIds: [] },
    { company: 'SHOP', scope: 'BRANCHES', branchIds: [] },
    { company: 'SHOP', scope: 'COMPANY', branchIds: ['b'] },
    { company: 'SHOP', scope: 'UNKNOWN', branchIds: [] },
    { company: 'SHOP', scope: 'BRANCHES', branchIds: ['missing'] },
  ])('rejects invalid assignment %j', async (assignment) => {
    db.user.findUnique.mockResolvedValue({
      id: 'actor',
      role: 'OWNER',
      isActive: true,
      accessRevision: 0,
    });
    db.accessPosition.findUnique.mockResolvedValue({
      id: 'p',
      code: 'SALES',
      isActive: true,
      deletedAt: null,
    });
    await expect(
      service.replaceAssignments('actor', 'actor', {
        expectedRevision: 0,
        assignments: [{ positionId: 'p', ...assignment } as any],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
