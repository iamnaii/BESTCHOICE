import { ForbiddenException, BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { EmployeeAccessService } from './employee-access.service';
import { ReplaceAccessAssignmentsDto, UpdateAccessPositionDto } from './employee-access.dto';
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
          accessRevision: 0,
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

  it('does not retrofit customer identity disclosure into saved template positions', async () => {
    const saved = { id: 'existing-manager', code: 'BRANCH_MANAGER', permissions: ['customers.read'] };
    db.accessPosition.findUnique.mockResolvedValue(saved);

    await expect(service.seedTemplates('actor')).resolves.toEqual({
      createdCount: 0,
      affectedEmployeeCount: 0,
    });

    expect(saved.permissions).toEqual(['customers.read']);
    expect(db.accessPosition.create).not.toHaveBeenCalled();
    expect(db.accessPosition.updateMany).not.toHaveBeenCalled();
    expect(db.employeeAccessAssignment.create).not.toHaveBeenCalled();
    expect(db.employeeAccessAssignment.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a stale position revision before mutation', async () => {
    db.accessPosition.findUnique.mockResolvedValue({ id: 'p', revision: 2, deletedAt: null });
    await expect(
      service.updatePosition('actor', 'p', { expectedRevision: 1, name: 'ใหม่' }),
    ).rejects.toThrow(ConflictException);
    expect(db.accessPosition.updateMany).not.toHaveBeenCalled();
  });
  it('forbids assignment replacement for the persisted owner account', async () => {
    await expect(
      service.replaceAssignments('actor', 'actor', { expectedRevision: 0, assignments: [] }),
    ).rejects.toThrow(ForbiddenException);
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it.each([
    { company: 'OTHER', scope: 'COMPANY', branchIds: [] },
    { company: 'SHOP', scope: 'BRANCHES', branchIds: [] },
    { company: 'SHOP', scope: 'COMPANY', branchIds: ['b'] },
    { company: 'SHOP', scope: 'UNKNOWN', branchIds: [] },
    { company: 'SHOP', scope: 'BRANCHES', branchIds: ['missing'] },
  ])('rejects invalid assignment %j', async (assignment) => {
    db.user.findUnique
      .mockResolvedValueOnce({ id: 'actor', role: 'OWNER', isActive: true })
      .mockResolvedValueOnce({ id: 'target', role: 'SALES', isActive: true, accessRevision: 0 });
    db.accessPosition.findUnique.mockResolvedValue({
      id: 'p',
      code: 'SALES',
      isActive: true,
      deletedAt: null,
    });
    await expect(
      service.replaceAssignments('actor', 'target', {
        expectedRevision: 0,
        assignments: [{ positionId: 'p', ...assignment } as any],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('employee access review request validation', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const positionId = '0d883600-a8e7-4422-9a20-afe46abaa8d3';
  const assignment = { positionId, company: 'SHOP', scope: 'COMPANY', branchIds: [] };

  it('accepts both zero-valued and omitted expectations', async () => {
    const position = { expectedRevision: 3, expectedAffectedEmployeeCount: 0 };
    const assignments = { expectedRevision: 4, assignments: [assignment, { ...assignment, expectedPositionRevision: 0 }] };
    await expect(pipe.transform(position, { type: 'body', metatype: UpdateAccessPositionDto })).resolves.toEqual(position);
    await expect(pipe.transform(assignments, { type: 'body', metatype: ReplaceAccessAssignmentsDto })).resolves.toEqual(assignments);
    await expect(pipe.transform({ expectedRevision: 3 }, { type: 'body', metatype: UpdateAccessPositionDto })).resolves.toEqual({ expectedRevision: 3 });
  });

  it.each([-1, 1.5, '3', '', false, null])('rejects an invalid review expectation %j', async (value) => {
    await expect(pipe.transform(
      { expectedRevision: 3, expectedAffectedEmployeeCount: value },
      { type: 'body', metatype: UpdateAccessPositionDto },
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform(
      { expectedRevision: 4, assignments: [{ ...assignment, expectedPositionRevision: value }] },
      { type: 'body', metatype: ReplaceAccessAssignmentsDto },
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});
