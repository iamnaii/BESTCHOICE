import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { AccountRoleService } from '../journal/account-role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * D1.1.1.6 — Audit log on CRUD operations of account_role_map.
 *
 * Actions emitted:
 *   - ROLE_MAP_CREATED    — when `create()` adds a row
 *   - ROLE_MAP_UPDATED    — when `update()` modifies fields (NOT a deactivation)
 *   - ROLE_MAP_DEACTIVATED — when `update()` flips `isActive` true → false
 *
 * `diffSummary` in newValue lets reviewers grep history without re-deriving
 * the diff.
 */
describe('AccountRoleService audit (D1.1.1.6)', () => {
  let service: AccountRoleService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

  beforeEach(async () => {
    prisma = {
      accountRoleMap: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        create: jest.fn(),
      },
      chartOfAccount: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AccountRoleService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = mod.get(AccountRoleService);
  });

  it('create() writes ROLE_MAP_CREATED with diffSummary', async () => {
    prisma.chartOfAccount.findFirst.mockResolvedValue({ code: '53-9999' });
    prisma.accountRoleMap.create.mockResolvedValue({
      id: 'rNew',
      role: 'new_role',
      accountCode: '53-9999',
      priority: 1,
      isActive: true,
      note: 'fresh seed',
    });

    await service.create(
      { role: 'new_role', accountCode: '53-9999', note: 'fresh seed' },
      'user-1',
    );

    expect(audit.log).toHaveBeenCalledTimes(1);
    const call = audit.log.mock.calls[0][0];
    expect(call.action).toBe('ROLE_MAP_CREATED');
    expect(call.entity).toBe('account_role_map');
    expect(call.entityId).toBe('rNew');
    expect(call.userId).toBe('user-1');
    expect(call.newValue).toMatchObject({
      role: 'new_role',
      accountCode: '53-9999',
      isActive: true,
    });
    expect(call.newValue.diffSummary).toContain('สร้าง role new_role → 53-9999');
    // oldValue should be absent on a create event
    expect(call.oldValue).toBeUndefined();
  });

  it('create() surfaces P2002 unique violation as ConflictException', async () => {
    prisma.chartOfAccount.findFirst.mockResolvedValue({ code: '53-9999' });
    prisma.accountRoleMap.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );

    await expect(
      service.create({ role: 'new_role', accountCode: '53-9999' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('update() emits ROLE_MAP_DEACTIVATED when isActive flips true→false (non-required role)', async () => {
    prisma.accountRoleMap.findUnique.mockResolvedValue({
      id: 'r1',
      role: 'custom_role',
      accountCode: '11-4101',
      priority: 1,
      isActive: true,
      note: null,
    });
    prisma.accountRoleMap.update.mockResolvedValue({
      id: 'r1',
      role: 'custom_role',
      accountCode: '11-4101',
      priority: 1,
      isActive: false,
      note: null,
    });

    await service.update('r1', { isActive: false }, 'user-1', 'OWNER');

    expect(audit.log).toHaveBeenCalledTimes(1);
    const call = audit.log.mock.calls[0][0];
    expect(call.action).toBe('ROLE_MAP_DEACTIVATED');
    expect(call.newValue.diffSummary).toContain('ปิดใช้งาน role custom_role');
  });
});
