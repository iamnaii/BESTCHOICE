import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  assertAccountingBranch,
  assertAccountingPermission,
  getAccountingPermissions,
  parseAccountingPermissions,
} from './accounting-permissions';

const RIGHTS = [
  'EXPENSE_POST',
  'EXPENSE_APPROVE',
  'EXPENSE_CANCEL',
  'INCOME_POST',
  'INCOME_APPROVE',
  'INCOME_CANCEL',
] as const;
type Client = Parameters<typeof getAccountingPermissions>[0];

describe('per-user accounting permissions', () => {
  const actor = { id: 'staff', name: 'บัญชี', role: UserRole.ACCOUNTANT, branchId: 'b1' };
  let db: { user: { findFirst: jest.Mock }; systemConfig: { findFirst: jest.Mock } };
  const client = () => db as unknown as Client;

  beforeEach(() => {
    db = {
      user: { findFirst: jest.fn().mockResolvedValue(actor) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  });

  it.each(RIGHTS)(
    'grants only explicitly assigned %s, without granting adjacent actions',
    async (permission) => {
      db.systemConfig.findFirst.mockResolvedValue({
        value: JSON.stringify({ staff: [permission] }),
      });
      expect(
        (await assertAccountingPermission(client(), actor.id, permission)).permissions,
      ).toEqual([permission]);
      for (const other of RIGHTS.filter((right) => right !== permission)) {
        await expect(assertAccountingPermission(client(), actor.id, other)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
    },
  );

  it.each([UserRole.FINANCE_MANAGER, UserRole.ACCOUNTANT, UserRole.BRANCH_MANAGER])(
    'does not infer rights from role %s when configuration is missing',
    async (role) => {
      db.user.findFirst.mockResolvedValue({ ...actor, role });
      expect((await getAccountingPermissions(client(), actor.id)).permissions).toEqual([]);
      await expect(
        assertAccountingPermission(client(), actor.id, 'EXPENSE_POST'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('OWNER receives all six actions only from current active database identity', async () => {
    db.user.findFirst.mockResolvedValue({ ...actor, role: UserRole.OWNER });
    expect((await getAccountingPermissions(client(), actor.id)).permissions).toEqual([...RIGHTS]);
    expect(db.systemConfig.findFirst).not.toHaveBeenCalled();
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: actor.id, isActive: true, deletedAt: null, isSystemUser: false },
      }),
    );
  });

  it('a downgraded OWNER token has no implicit privilege after the database role changes', async () => {
    db.user.findFirst.mockResolvedValueOnce({ ...actor, role: UserRole.OWNER });
    await expect(
      assertAccountingPermission(client(), actor.id, 'INCOME_CANCEL'),
    ).resolves.toBeDefined();
    await expect(
      assertAccountingPermission(client(), actor.id, 'INCOME_CANCEL'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('revocation takes effect on the next action without cached grants', async () => {
    db.systemConfig.findFirst.mockResolvedValueOnce({
      value: JSON.stringify({ staff: ['EXPENSE_CANCEL'] }),
    });
    await expect(
      assertAccountingPermission(client(), actor.id, 'EXPENSE_CANCEL'),
    ).resolves.toBeDefined();
    await expect(
      assertAccountingPermission(client(), actor.id, 'EXPENSE_CANCEL'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects deleted or disabled identities even if their policy entry still exists', async () => {
    db.user.findFirst.mockResolvedValue(null);
    db.systemConfig.findFirst.mockResolvedValue({ value: JSON.stringify({ staff: [...RIGHTS] }) });
    await expect(getAccountingPermissions(client(), actor.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not run an unscoped user query when actor id is absent', async () => {
    await expect(getAccountingPermissions(client(), '')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it.each([UserRole.SALES, UserRole.VIEWER])(
    'does not expand module access for assigned %s',
    async (role) => {
      db.user.findFirst.mockResolvedValue({ ...actor, role });
      db.systemConfig.findFirst.mockResolvedValue({
        value: JSON.stringify({ staff: [...RIGHTS] }),
      });
      expect((await getAccountingPermissions(client(), actor.id)).permissions).toEqual([]);
    },
  );

  it('BRANCH_MANAGER retains assigned expense rights but cannot gain income module access', async () => {
    db.user.findFirst.mockResolvedValue({ ...actor, role: UserRole.BRANCH_MANAGER });
    db.systemConfig.findFirst.mockResolvedValue({ value: JSON.stringify({ staff: [...RIGHTS] }) });
    expect((await getAccountingPermissions(client(), actor.id)).permissions).toEqual(
      RIGHTS.filter((right) => right.startsWith('EXPENSE_')),
    );
    await expect(
      assertAccountingPermission(client(), actor.id, 'INCOME_POST'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not inherit another user grant or a prototype property', async () => {
    db.user.findFirst.mockResolvedValue({ ...actor, id: 'toString' });
    db.systemConfig.findFirst.mockResolvedValue({
      value: JSON.stringify({ staff: ['EXPENSE_POST'] }),
    });
    expect((await getAccountingPermissions(client(), 'toString')).permissions).toEqual([]);
  });

  it.each([
    undefined,
    null,
    '',
    'broken',
    '[]',
    'null',
    'true',
    '{"staff":["UNKNOWN"]}',
    '{"staff":"INCOME_POST"}',
    '{"staff":[null]}',
    '{"staff":["INCOME_POST"],"other":["UNKNOWN"]}',
  ])('fails closed for malformed policy %s', (raw) => {
    expect(parseAccountingPermissions(raw)).toEqual({});
  });

  it('propagates a database read failure without converting it into permission', async () => {
    db.systemConfig.findFirst.mockRejectedValue(new Error('database unavailable'));
    await expect(assertAccountingPermission(client(), actor.id, 'EXPENSE_POST')).rejects.toThrow(
      'database unavailable',
    );
  });

  it('reads only the active accounting policy key', async () => {
    await getAccountingPermissions(client(), actor.id);
    expect(db.systemConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'accounting_permissions', deletedAt: null },
      }),
    );
  });
});

describe('accounting branch access', () => {
  it('allows a branch manager only within the currently assigned branch', () => {
    const user = { role: 'BRANCH_MANAGER', branchId: 'b1' };
    expect(() => assertAccountingBranch(user, 'b1')).not.toThrow();
    expect(() => assertAccountingBranch(user, 'b2')).toThrow(ForbiddenException);
    expect(() => assertAccountingBranch({ ...user, branchId: 'b2' }, 'b1')).toThrow(
      ForbiddenException,
    );
  });

  it.each([
    [null, 'b1'],
    ['b1', null],
    [null, null],
  ])('rejects an unscoped branch-manager actor/document (%s, %s)', (branchId, documentBranchId) => {
    expect(() =>
      assertAccountingBranch({ role: 'BRANCH_MANAGER', branchId }, documentBranchId),
    ).toThrow(ForbiddenException);
  });

  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])(
    'preserves existing cross-branch scope for %s',
    (role) => {
      expect(() =>
        assertAccountingBranch({ role, branchId: null }, 'another-branch'),
      ).not.toThrow();
    },
  );
});
