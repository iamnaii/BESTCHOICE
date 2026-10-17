import { ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { AccessSnapshotService, assertNotLastOwner } from './access-snapshot.service';

describe('current access snapshots', () => {
  let db: any;
  let service: AccessSnapshotService;
  const account = {
    id: 'staff',
    role: 'SALES',
    isActive: true,
    accessManaged: true,
    accessRevision: 4,
  };
  beforeEach(() => {
    db = {
      user: {
        findUnique: jest.fn().mockResolvedValue(account),
        count: jest.fn().mockResolvedValue(0),
      },
      employeeAccessAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    db.$transaction = (fn: any) => fn(db);
    service = new AccessSnapshotService(db);
  });
  it.each([
    null,
    { ...account, isActive: false },
    { ...account, deletedAt: new Date() },
    { ...account, isSystemUser: true },
    { ...account, role: 'CUSTOMER' },
  ])('rejects nonstaff/inactive identity %j', async (user) => {
    db.user.findUnique.mockResolvedValue(user);
    await expect(service.forUser('staff')).rejects.toThrow(ForbiddenException);
  });
  it('returns explicit legacy status without silently adding position grants', async () => {
    db.user.findUnique.mockResolvedValue({ ...account, accessManaged: false });
    expect(await service.forUser('staff')).toEqual({
      userId: 'staff',
      isOwner: false,
      managed: false,
      revision: 4,
      grants: [],
    });
    expect(db.employeeAccessAssignment.findMany).not.toHaveBeenCalled();
  });
  it('derives owner authority only from the account and ignores reserved permissions in stored positions', async () => {
    db.employeeAccessAssignment.findMany.mockResolvedValue([
      {
        positionId: 'p',
        companyCode: 'SHOP',
        scope: 'COMPANY',
        branches: [],
        position: { code: 'OWNER', permissions: ['positions.manage'] },
      },
    ]);
    const result = await service.forUser('staff');
    expect(result.isOwner).toBe(false);
    expect(result.grants).toEqual([]);
    db.user.findUnique.mockResolvedValue({ ...account, role: 'OWNER' });
    expect((await service.forUser('staff')).isOwner).toBe(true);
  });
  it('does not broaden ASSIGNED grants when a branch becomes inactive', async () => {
    db.employeeAccessAssignment.findMany.mockResolvedValue([
      {
        positionId: 'p',
        companyCode: 'FINANCE',
        scope: 'ASSIGNED',
        position: { code: 'FINANCE', permissions: ['payments.read'] },
        branches: [
          {
            branchId: 'b',
            branch: {
              isActive: false,
              deletedAt: null,
              company: { companyCode: 'FINANCE', isActive: true },
            },
          },
        ],
      },
    ]);
    const result = await service.forUser('staff');
    expect(result.grants).toEqual([]);
    expect(
      canAccess(result, 'payments.read', { company: 'FINANCE', assignedUserIds: ['staff'] }),
    ).toBe(false);
  });
  it('empty ASSIGNED branch list still requires actual case ownership', async () => {
    db.employeeAccessAssignment.findMany.mockResolvedValue([
      {
        positionId: 'p',
        companyCode: 'FINANCE',
        scope: 'ASSIGNED',
        branches: [],
        position: {
          code: 'FINANCE',
          permissions: ['payments.read', 'positions.manage', 'unknown.permission'],
        },
      },
    ]);
    const result = await service.forUser('staff');
    expect(result.grants[0].permissions).toEqual(['payments.read']);
    expect(
      canAccess(result, 'payments.read', { company: 'FINANCE', assignedUserIds: ['staff'] }),
    ).toBe(true);
    expect(canAccess(result, 'payments.read', { company: 'FINANCE' })).toBe(false);
  });
  it('reloads the account after revocation on the next call', async () => {
    await service.forUser('staff');
    db.user.findUnique.mockResolvedValue({ ...account, isActive: false });
    await expect(service.forUser('staff')).rejects.toThrow(ForbiddenException);
    expect(db.user.findUnique).toHaveBeenCalledTimes(2);
  });
  it.each([{ isActive: false }, { role: 'SALES' }, { deletedAt: new Date() }])(
    'protects the final persisted owner for %j',
    async (next) => {
      db.user.findUnique.mockResolvedValue({ ...account, role: 'OWNER' });
      await expect(assertNotLastOwner(db, 'staff', next)).rejects.toThrow(ForbiddenException);
      db.user.count.mockResolvedValue(1);
      await expect(assertNotLastOwner(db, 'staff', next)).resolves.toBeUndefined();
    },
  );
});
