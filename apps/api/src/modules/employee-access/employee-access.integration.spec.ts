import { PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { randomUUID } from 'crypto';
import { AccessSnapshotService } from './access-snapshot.service';
import { EmployeeAccessService } from './employee-access.service';
import { UsersService } from '../users/users.service';

// Run only with the explicit isolated test database URL, never inherited DATABASE_URL.
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url || !url.includes('/bc_access_task2?host=/tmp/bc-access-'))
  throw new Error('Explicit isolated employee-access test URL required');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshot = new AccessSnapshotService(db as any);
const service = new EmployeeAccessService(db as any, snapshot);
const users = new UsersService(
  db as any,
  { log: jest.fn() } as any,
  { upsertProfileTx: jest.fn() } as any,
);
let owner: string, staff: string, other: string, branch: string, position: string;
const suffix = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();

beforeAll(async () => {
  await db.companyInfo.upsert({
    where: { companyCode: 'SHOP' },
    create: {
      companyCode: 'SHOP',
      nameTh: 'ทดสอบ SHOP',
      taxId: 'TEST',
      address: 'TEST',
      directorName: 'TEST',
    },
    update: {},
  });
  await db.companyInfo.upsert({
    where: { companyCode: 'FINANCE' },
    create: {
      companyCode: 'FINANCE',
      nameTh: 'ทดสอบ FINANCE',
      taxId: 'TEST',
      address: 'TEST',
      directorName: 'TEST',
    },
    update: {},
  });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branch = (await db.branch.create({ data: { name: `TEST-${suffix}`, companyId: shop.id } })).id;
  owner = (
    await db.user.create({
      data: {
        name: 'TEST Owner',
        email: `${suffix}-owner@test.invalid`,
        password: 'unused',
        role: 'OWNER',
      },
    })
  ).id;
  staff = (
    await db.user.create({
      data: {
        name: 'TEST Sales',
        email: `${suffix}-sales@test.invalid`,
        password: 'unused',
        role: 'SALES',
        branchId: branch,
        canReverseOverride: true,
      },
    })
  ).id;
  other = (
    await db.user.create({
      data: {
        name: 'TEST Other',
        email: `${suffix}-other@test.invalid`,
        password: 'unused',
        role: 'SALES',
      },
    })
  ).id;
  position = (
    await service.createPosition(owner, {
      code: `TEST_${suffix}`,
      name: 'ทดสอบ',
      permissions: ['sales.read'],
    })
  ).id;
}, 30000);
afterAll(() => db.$disconnect());

const assign = (userId: string, expectedRevision: number) =>
  service.replaceAssignments(owner, userId, {
    expectedRevision,
    assignments: [
      { positionId: position, company: 'SHOP', scope: 'BRANCHES', branchIds: [branch] },
    ],
  });

test('explicit template initialization is idempotent and grants no owner accounts', async () => {
  const accountsBefore = await db.user.count();
  expect((await service.seedTemplates(owner)).createdCount).toBe(8);
  expect((await service.seedTemplates(owner)).createdCount).toBe(0);
  expect(await db.accessPosition.findUnique({ where: { code: 'OWNER' } })).toBeNull();
  expect(await db.user.count()).toBe(accountsBefore);
  expect((await snapshot.forUser(staff)).managed).toBe(false);
});

test('legacy preview is read-only, preserves companies, and enumerates personal grants', async () => {
  await db.systemConfig.upsert({
    where: { key: 'accounting_permissions' },
    create: { key: 'accounting_permissions', value: JSON.stringify({ [staff]: ['EXPENSE_POST'] }) },
    update: { value: JSON.stringify({ [staff]: ['EXPENSE_POST'] }) },
  });
  const preview = (await service.migrationPreview(owner)).find((row) => row.id === staff)!;
  expect(preview.managed).toBe(false);
  expect(preview.proposedPositionCode).toBe('SALES');
  expect(preview.personalGrants).toMatchObject({
    canReverseOverride: true,
    accounting_permissions: ['EXPENSE_POST'],
  });
  expect(await snapshot.forUser(staff)).toMatchObject({ managed: false, grants: [] });
});

test('managed replacement clears personal grants and records durable audit', async () => {
  const result = await assign(staff, 0);
  expect(result).toMatchObject({ managed: true, revision: 1, affectedEmployeeCount: 1 });
  expect(canAccess(result, 'sales.read', { company: 'SHOP', branchId: branch })).toBe(true);
  const legacy = await db.systemConfig.findUniqueOrThrow({
    where: { key: 'accounting_permissions' },
  });
  expect(JSON.parse(legacy.value)[staff]).toBeUndefined();
  expect((await db.user.findUniqueOrThrow({ where: { id: staff } })).canReverseOverride).toBeNull();
  expect(
    await db.auditLog.count({ where: { entityId: staff, action: 'ACCESS_ASSIGNMENTS_REPLACED' } }),
  ).toBe(1);
});

test('position edits update every assigned user immediately and invalidate open assignment forms', async () => {
  await assign(other, 0);
  const result = await service.updatePosition(owner, position, {
    expectedRevision: 0,
    permissions: ['sales.read', 'sensitive.cost.read'],
  });
  expect(result.affectedEmployeeCount).toBe(2);
  for (const id of [staff, other]) {
    const current = await snapshot.forUser(id);
    expect(current.revision).toBe(2);
    expect(canAccess(current, 'sensitive.cost.read', { company: 'SHOP', branchId: branch })).toBe(
      true,
    );
  }
  await expect(assign(staff, 1)).rejects.toBeInstanceOf(ConflictException);
});

test('concurrent position edits with the same revision have exactly one winner', async () => {
  const results = await Promise.allSettled([
    service.updatePosition(owner, position, { expectedRevision: 1, name: 'first' }),
    service.updatePosition(owner, position, { expectedRevision: 1, name: 'second' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
});

test('durable audit failure rolls back position, assignments and revisions', async () => {
  const beforePosition = await db.accessPosition.findUniqueOrThrow({ where: { id: position } });
  const before = await snapshot.forUser(staff);
  const broken = {
    $transaction: (callback: any) =>
      db.$transaction((tx) =>
        callback(
          new Proxy(tx, {
            get(target, property) {
              if (property === 'auditLog')
                return {
                  create: () => {
                    throw new Error('audit unavailable');
                  },
                };
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
        ),
      ),
  };
  const failing = new EmployeeAccessService(broken as any, snapshot);
  await expect(
    failing.updatePosition(owner, position, {
      expectedRevision: beforePosition.revision,
      permissions: [],
    }),
  ).rejects.toThrow('audit unavailable');
  expect(await snapshot.forUser(staff)).toEqual(before);
  expect((await db.accessPosition.findUniqueOrThrow({ where: { id: position } })).revision).toBe(
    beforePosition.revision,
  );
  await expect(
    failing.replaceAssignments(owner, staff, {
      expectedRevision: before.revision,
      assignments: [],
    }),
  ).rejects.toThrow('audit unavailable');
  expect(await snapshot.forUser(staff)).toEqual(before);
});

test('FINANCE branch scope uses SHOP origin branches without granting SHOP access', async () => {
  const financeUser = await db.user.create({
    data: {
      name: 'TEST Finance',
      email: `${suffix}-finance@test.invalid`,
      password: 'unused',
      role: 'FINANCE_MANAGER',
    },
  });
  const result = await service.replaceAssignments(owner, financeUser.id, {
    expectedRevision: 0,
    assignments: [
      { positionId: position, company: 'FINANCE', scope: 'BRANCHES', branchIds: [branch] },
    ],
  });
  expect(canAccess(result, 'sales.read', { company: 'FINANCE', branchId: branch })).toBe(true);
  expect(canAccess(result, 'sales.read', { company: 'SHOP', branchId: branch })).toBe(false);
});

test('invalid company/branch and disabled positions cannot be assigned', async () => {
  const revision = (await snapshot.forUser(staff)).revision;
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const financeBranch = await db.branch.create({
    data: { name: 'TEST finance branch', companyId: finance.id },
  });
  await expect(
    service.replaceAssignments(owner, staff, {
      expectedRevision: revision,
      assignments: [
        { positionId: position, company: 'SHOP', scope: 'BRANCHES', branchIds: [financeBranch.id] },
      ],
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
  const current = await db.accessPosition.findUniqueOrThrow({ where: { id: position } });
  await service.updatePosition(owner, position, {
    expectedRevision: current.revision,
    isActive: false,
  });
  expect((await snapshot.forUser(staff)).grants).toEqual([]);
  await expect(assign(staff, revision + 1)).rejects.toBeInstanceOf(BadRequestException);
});

test('disabled/deleted staff and forged owner position never produce owner snapshots', async () => {
  await db.user.update({ where: { id: other }, data: { isActive: false } });
  await expect(snapshot.forUser(other)).rejects.toBeInstanceOf(ForbiddenException);
  await db.user.update({ where: { id: other }, data: { isActive: true, deletedAt: new Date() } });
  await expect(snapshot.forUser(other)).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    service.createPosition(staff, { code: 'OWNER', name: 'เจ้าของ', permissions: [] }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect((await snapshot.forUser(staff)).isOwner).toBe(false);
});

test('both existing account mutation routes protect the last owner', async () => {
  // A fresh isolated database contains only this test owner.
  expect(
    await db.user.count({
      where: { role: 'OWNER', isActive: true, deletedAt: null, isSystemUser: false },
    }),
  ).toBe(1);
  await expect(users.update(owner, { isActive: false })).rejects.toBeInstanceOf(ForbiddenException);
  await expect(users.updateFull(owner, { role: 'SALES' })).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect((await snapshot.forUser(owner)).isOwner).toBe(true);
});

test('concurrent removals cannot remove the final two owners', async () => {
  const second = await db.user.create({
    data: {
      name: 'TEST Owner2',
      email: `${suffix}-owner2@test.invalid`,
      password: 'unused',
      role: 'OWNER',
    },
  });
  const outcomes = await Promise.allSettled([
    users.update(owner, { isActive: false }),
    users.updateFull(second.id, { isActive: false }),
  ]);
  expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(
    await db.user.count({
      where: { role: 'OWNER', isActive: true, deletedAt: null, isSystemUser: false },
    }),
  ).toBe(1);
});

test.each([
  ['update', { isActive: false }],
  ['update', { password: 'replacement-password' }],
  ['updateFull', { isActive: false }],
  ['updateFull', { password: 'replacement-password' }],
] as const)(
  '%s rejects and rolls back account/token changes when revocation SQL fails: %j',
  async (method, dto) => {
    const target = await db.user.create({
      data: {
        name: 'TEST Atomic Revocation',
        email: `${randomUUID()}@test.invalid`,
        password: 'unchanged-password-hash',
        role: 'SALES',
      },
    });
    const token = await db.refreshToken.create({
      data: {
        userId: target.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    // A real PostgreSQL statement failure aborts the transaction. A JS-only mock cannot prove this.
    await db.$executeRawUnsafe(
      `CREATE FUNCTION test_reject_refresh_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test refresh-token write failure'; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_reject_refresh_revocation BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION test_reject_refresh_revocation()`,
    );
    try {
      const [outcome] = await Promise.allSettled([users[method](target.id, dto)]);
      expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
        isActive: true,
        password: 'unchanged-password-hash',
      });
      expect(await db.refreshToken.findUniqueOrThrow({ where: { id: token.id } })).toMatchObject({
        isRevoked: false,
        revokedAt: null,
      });
      expect(outcome.status).toBe('rejected');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_reject_refresh_revocation ON refresh_tokens');
      await db.$executeRawUnsafe('DROP FUNCTION test_reject_refresh_revocation()');
    }
  },
);
