import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AccessSnapshotService } from './access-snapshot.service';
import { EmployeeAccessConsoleService } from './employee-access-console.service';
import { EmployeeAccessController } from './employee-access.controller';
import { EmployeeAccessService } from './employee-access.service';

const owner = {
  id: 'owner',
  name: 'Test Owner',
  role: 'OWNER',
  isActive: true,
  isSystemUser: false,
  deletedAt: null,
  accessManaged: true,
  accessRevision: 3,
};
const staff = { ...owner, id: 'staff', role: 'SALES', accessManaged: false, accessRevision: 0 };
const branches = [
  { id: 'b1', name: 'Test SHOP branch', company: { companyCode: 'SHOP' } },
  { id: 'b2', name: 'Test FINANCE branch', company: { companyCode: 'FINANCE' } },
];
const createdAt = new Date('2026-11-24T10:00:00Z');
const actor = { id: owner.id, name: owner.name };
const paths = ['context', 'employees/staff/effective-access', 'history'];

describe('owner employee access console API', () => {
  let app: INestApplication;
  let snapshots: AccessSnapshotService;
  const secret = 'employee-access-console-unit-test';
  const jwt = new JwtService({ secret });
  const token = (sub: string) => `Bearer ${jwt.sign({ sub, role: 'OWNER', aud: 'admin' })}`;
  const db = {
    user: { findUnique: jest.fn() },
    companyInfo: { findMany: jest.fn() },
    branch: { findMany: jest.fn() },
    employeeAccessAssignment: { findMany: jest.fn() },
    auditLog: { count: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const get = (path: string, userId = owner.id) =>
    request(app.getHttpServer())
      .get(`/employee-access/${path}`)
      .set('Authorization', token(userId));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [EmployeeAccessController],
      providers: [
        JwtStrategy,
        AccessSnapshotService,
        EmployeeAccessConsoleService,
        EmployeeAccessService,
        { provide: ConfigService, useValue: { get: () => secret } },
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    snapshots = module.get(AccessSnapshotService);
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation((fn) => fn(db));
    db.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === owner.id ? owner : where.id === staff.id ? staff : null,
    );
    db.companyInfo.findMany.mockResolvedValue([
      { companyCode: 'SHOP' },
      { companyCode: 'FINANCE' },
    ]);
    db.branch.findMany.mockResolvedValue(branches);
    db.employeeAccessAssignment.findMany.mockResolvedValue([]);
    db.auditLog.count.mockResolvedValue(0);
    db.auditLog.findMany.mockResolvedValue([]);
  });

  it.each(paths)('requires an authenticated owner for %s', async (path) => {
    await request(app.getHttpServer()).get(`/employee-access/${path}`).expect(401);
    await get(path, staff.id).expect(403);
  });

  it.each(paths)(
    'rechecks the persisted owner after the authenticated snapshot for %s',
    async (path) => {
      db.user.findUnique
        .mockResolvedValueOnce(owner)
        .mockResolvedValue({ ...owner, role: 'SALES' });
      const authSnapshot = jest.spyOn(snapshots, 'forUser').mockResolvedValueOnce({
        userId: owner.id,
        managed: true,
        isOwner: true,
        revision: 3,
        grants: [],
      });
      try {
        await get(path).expect(403);
        expect(db.user.findUnique).toHaveBeenCalledTimes(2);
      } finally {
        authSnapshot.mockRestore();
      }
    },
  );

  it('provides only active assignment work and branch options to a managed owner', async () => {
    await get('context').expect(200, {
      companies: ['SHOP', 'FINANCE'],
      branches: [
        { id: 'b1', name: 'Test SHOP branch', companyCode: 'SHOP' },
        { id: 'b2', name: 'Test FINANCE branch', companyCode: 'FINANCE' },
      ],
    });
    expect(db.companyInfo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, deletedAt: null, companyCode: { in: ['SHOP', 'FINANCE'] } },
      }),
    );
    expect(db.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          deletedAt: null,
          company: { isActive: true, deletedAt: null, companyCode: { in: ['SHOP', 'FINANCE'] } },
        },
      }),
    );
  });

  it('returns the actual snapshot policy for active staff and rejects missing or inactive targets', async () => {
    db.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === owner.id) return owner;
      if (where.id === staff.id) return { ...staff, accessManaged: true, accessRevision: 4 };
      if (where.id === 'disabled') return { ...staff, id: 'disabled', isActive: false };
      return null;
    });
    db.employeeAccessAssignment.findMany.mockResolvedValue([
      {
        positionId: 'p1',
        companyCode: 'SHOP',
        scope: 'ASSIGNED',
        position: { code: 'SALES', permissions: ['sales.read', 'positions.manage'] },
        branches: [],
      },
    ]);
    await get('employees/staff/effective-access').expect(200, {
      userId: 'staff',
      managed: true,
      isOwner: false,
      revision: 4,
      grants: [
        {
          positionId: 'p1',
          permissions: ['sales.read'],
          company: 'SHOP',
          scope: 'ASSIGNED',
          branchIds: [],
        },
      ],
    });
    await get('employees/disabled/effective-access').expect(403);
    await get('employees/missing/effective-access').expect(403);
  });

  it('returns only the allowlisted assignment, position, and template history fields', async () => {
    const position = {
      id: 'p1',
      code: 'TEST_ACCESS',
      name: 'Test access',
      permissions: ['sales.read', 'not.a.permission', { secret: 'injected' }],
      isActive: true,
      revision: 1,
      affectedEmployeeCount: 5,
      internalNotes: 'injected',
    };
    db.auditLog.count.mockResolvedValue(3);
    db.auditLog.findMany.mockResolvedValue([
      {
        id: 'a3',
        createdAt,
        action: 'ACCESS_ASSIGNMENTS_REPLACED',
        entity: 'user',
        entityId: 'staff',
        user: { ...actor, email: 'injected' },
        ipAddress: 'injected',
        oldValue: {
          managed: false,
          revision: 0,
          removedLegacyGrants: { accounting_permissions: ['injected'] },
          assignments: [
            {
              positionId: 'p1',
              companyCode: 'SHOP',
              scope: 'BRANCHES',
              branches: [{ branchId: 'b1', assignmentId: 'injected' }],
              userId: 'injected',
            },
            {
              positionId: { secret: 'injected' },
              companyCode: 'FINANCE',
              scope: 'COMPANY',
              branches: [],
            },
          ],
        },
        newValue: {
          managed: true,
          revision: 1,
          userId: 'injected',
          isOwner: false,
          grants: [
            {
              positionId: 'p1',
              company: 'FINANCE',
              scope: 'ASSIGNED',
              branchIds: ['b1'],
              permissions: ['sales.read'],
              userId: 'injected',
            },
          ],
        },
      },
      {
        id: 'a2',
        createdAt,
        action: 'ACCESS_POSITION_UPDATED',
        entity: 'access_position',
        entityId: 'p1',
        user: actor,
        oldValue: { ...position, revision: 0, name: { secret: 'injected' } },
        newValue: position,
      },
      {
        id: 'a1',
        createdAt,
        action: 'ACCESS_TEMPLATES_CREATED',
        entity: 'access_position',
        entityId: 'templates',
        user: actor,
        oldValue: null,
        newValue: [position, 'injected'],
      },
    ]);

    const safePosition = {
      id: 'p1',
      code: 'TEST_ACCESS',
      name: 'Test access',
      permissions: ['sales.read'],
      isActive: true,
      revision: 1,
    };
    const { name: _malformedName, ...previousPosition } = safePosition;
    await get('history').expect(200, {
      total: 3,
      page: 1,
      limit: 20,
      items: [
        {
          id: 'a3',
          createdAt: createdAt.toISOString(),
          action: 'ACCESS_ASSIGNMENTS_REPLACED',
          entity: 'user',
          entityId: 'staff',
          actor,
          before: {
            managed: false,
            revision: 0,
            assignments: [
              { positionId: 'p1', company: 'SHOP', scope: 'BRANCHES', branchIds: ['b1'] },
            ],
          },
          after: {
            managed: true,
            revision: 1,
            assignments: [
              { positionId: 'p1', company: 'FINANCE', scope: 'ASSIGNED', branchIds: ['b1'] },
            ],
          },
        },
        {
          id: 'a2',
          createdAt: createdAt.toISOString(),
          action: 'ACCESS_POSITION_UPDATED',
          entity: 'access_position',
          entityId: 'p1',
          actor,
          before: { ...previousPosition, revision: 0 },
          after: safePosition,
        },
        {
          id: 'a1',
          createdAt: createdAt.toISOString(),
          action: 'ACCESS_TEMPLATES_CREATED',
          entity: 'access_position',
          entityId: 'templates',
          actor,
          before: null,
          after: [safePosition],
        },
      ],
    });
    const where = {
      OR: [
        {
          entity: 'access_position',
          action: { in: ['ACCESS_POSITION_CREATED', 'ACCESS_POSITION_UPDATED'] },
        },
        { entity: 'access_position', action: 'ACCESS_TEMPLATES_CREATED', entityId: 'templates' },
        { entity: 'user', action: 'ACCESS_ASSIGNMENTS_REPLACED' },
      ],
    };
    expect(db.auditLog.count).toHaveBeenCalledWith({ where });
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });

  it('bounds the page size and skips DB row retrieval for a page past the end', async () => {
    db.auditLog.count.mockResolvedValue(80);
    await get('history?page=2&limit=50').expect(200, { items: [], total: 80, page: 2, limit: 50 });
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 50,
        take: 50,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    db.auditLog.findMany.mockClear();
    await get('history?page=9007199254740991').expect(200, {
      items: [],
      total: 80,
      page: Number.MAX_SAFE_INTEGER,
      limit: 20,
    });
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=9007199254740992',
    'page=1&page=2',
    'limit=0',
    'limit=51',
    'limit=other',
  ])('rejects invalid history paging %s', async (query) => {
    await get(`history?${query}`).expect(400);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});
