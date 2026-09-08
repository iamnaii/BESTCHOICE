import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAccountingSettingsDto } from '../dto/update-accounting-settings.dto';
import { AccountingPermissionsController } from '../accounting-permissions.controller';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AccountingPermissionsService } from './accounting-permissions.service';
import { SettingsWriteService } from './settings-write.service';

const OWNER = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-000000000002';
const BRANCH_MANAGER = '00000000-0000-4000-8000-000000000003';
const RIGHTS = [
  'EXPENSE_POST',
  'EXPENSE_APPROVE',
  'EXPENSE_CANCEL',
  'INCOME_POST',
  'INCOME_APPROVE',
  'INCOME_CANCEL',
] as const;

describe('accounting permission settings', () => {
  let state: string;
  let db: any;
  let service: AccountingPermissionsService;
  const users = [
    { id: OWNER, name: 'เจ้าของ', role: 'OWNER', branchId: null },
    { id: STAFF, name: 'พนักงานบัญชี', role: 'ACCOUNTANT', branchId: 'b1' },
    { id: BRANCH_MANAGER, name: 'ผู้จัดการสาขา', role: 'BRANCH_MANAGER', branchId: 'b1' },
  ];

  beforeEach(() => {
    state = JSON.stringify({ [STAFF]: ['EXPENSE_POST'] });
    db = {
      user: {
        findFirst: jest.fn(async ({ where }) => users.find((user) => user.id === where.id) ?? null),
        findMany: jest.fn(async ({ where }) =>
          users.filter((user) => !where.id || where.id.in.includes(user.id)),
        ),
      },
      systemConfig: {
        findFirst: jest.fn(async () => ({ value: state })),
        upsert: jest.fn(async ({ update }) => {
          state = update.value;
          return { value: state };
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue([]),
    };
    db.$transaction = jest.fn(async (fn) => {
      const before = state;
      try {
        return await fn(db);
      } catch (error) {
        state = before;
        throw error;
      }
    });
    service = new AccountingPermissionsService(db as PrismaService);
  });

  it('lists only eligible active non-system users, with OWNER all rights and explicit staff assignments', async () => {
    const result = await service.getSettings(OWNER);
    expect(result.users).toEqual([
      expect.objectContaining({ id: OWNER, permissions: [...RIGHTS] }),
      expect.objectContaining({ id: STAFF, permissions: ['EXPENSE_POST'] }),
      expect.objectContaining({ id: BRANCH_MANAGER, permissions: [] }),
    ]);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          isActive: true,
          isSystemUser: false,
          role: {
            in: expect.arrayContaining([
              'OWNER',
              'FINANCE_MANAGER',
              'ACCOUNTANT',
              'BRANCH_MANAGER',
            ]),
          },
        }),
        select: { id: true, name: true, role: true },
      }),
    );
  });

  it('rejects a current non-owner even if a stale session claimed OWNER', async () => {
    await expect(service.getSettings(STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateSettings({ users: [] }, STAFF)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('rechecks OWNER active identity inside the mutation transaction', async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(service.updateSettings({ users: [] }, OWNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OWNER, isActive: true, deletedAt: null, isSystemUser: false },
      }),
    );
  });

  it('replaces policy and audits the exact previous and next assignment', async () => {
    const result = await service.updateSettings(
      { users: [{ userId: STAFF, permissions: ['INCOME_CANCEL'] }] },
      OWNER,
    );
    expect(result.users.find((user) => user.id === STAFF)?.permissions).toEqual(['INCOME_CANCEL']);
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: OWNER,
        entity: 'SystemConfig',
        entityId: 'accounting_permissions',
        oldValue: { permissions: { [STAFF]: ['EXPENSE_POST'] } },
        newValue: { permissions: { [STAFF]: ['INCOME_CANCEL'] } },
      }),
    });
    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it('propagates an audit failure so the full policy transaction can roll back', async () => {
    const before = state;
    db.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(service.updateSettings({ users: [] }, OWNER)).rejects.toThrow('audit unavailable');
    expect(state).toBe(before);
  });

  it('revokes omitted staff while preserving built-in OWNER rights', async () => {
    const result = await service.updateSettings({ users: [] }, OWNER);
    expect(JSON.parse(state)).toEqual({});
    expect(result.users.find((user) => user.id === STAFF)?.permissions).toEqual([]);
    expect(result.users.find((user) => user.id === OWNER)?.permissions).toEqual([...RIGHTS]);
  });

  it('does not let an assignment remove OWNER rights', async () => {
    const result = await service.updateSettings(
      { users: [{ userId: OWNER, permissions: [] }] },
      OWNER,
    );
    expect(result.users.find((user) => user.id === OWNER)?.permissions).toEqual([...RIGHTS]);
    expect(JSON.parse(state)[OWNER]).toBeUndefined();
  });

  it('rejects missing, deactivated or deleted targets and duplicate users', async () => {
    await expect(
      service.updateSettings(
        { users: [{ userId: 'missing', permissions: ['EXPENSE_POST'] }] },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings(
        {
          users: [
            { userId: STAFF, permissions: [] },
            { userId: STAFF, permissions: [] },
          ],
        },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('accepts expense grants for a branch manager and rejects income grants beyond module access', async () => {
    await expect(
      service.updateSettings(
        { users: [{ userId: BRANCH_MANAGER, permissions: ['EXPENSE_APPROVE'] }] },
        OWNER,
      ),
    ).resolves.toBeDefined();
    db.systemConfig.upsert.mockClear();
    await expect(
      service.updateSettings(
        { users: [{ userId: BRANCH_MANAGER, permissions: ['INCOME_APPROVE'] }] },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('getMyPermissions cannot return another selected user identity', async () => {
    expect(await service.getMyPermissions(STAFF)).toEqual({
      user: users[1],
      permissions: ['EXPENSE_POST'],
    });
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: STAFF }) }),
    );
  });

  it('blocks policy replacement through both generic settings writers', async () => {
    const audit = { log: jest.fn() } as unknown as AuditService;
    const generic = new SettingsWriteService(db as PrismaService, audit);
    await expect(generic.update('accounting_permissions', '{}', OWNER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      generic.bulkUpdate([{ key: 'accounting_permissions', value: '{}' }], OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });
  it.each([
    { users: [{ userId: 'bad-id', permissions: ['EXPENSE_POST'] }] },
    { users: [{ userId: STAFF, permissions: ['UNKNOWN'] }] },
    { users: [{ userId: STAFF, permissions: ['INCOME_POST', 'INCOME_POST'] }] },
    { users: [{ userId: STAFF, permissions: [] }, { userId: STAFF, permissions: [] }] },
    { users: [{ userId: STAFF }] }, { users: [null] },
  ])('DTO rejects malformed grants %#', async (payload) => {
    expect((await validate(plainToInstance(UpdateAccountingSettingsDto, payload))).length).toBeGreaterThan(0);
  });

  it('keeps policy administration OWNER-only at the controller boundary', () => {
    expect(Reflect.getMetadata('roles', AccountingPermissionsController.prototype.getSettings)).toEqual(['OWNER']);
    expect(Reflect.getMetadata('roles', AccountingPermissionsController.prototype.updateSettings)).toEqual(['OWNER']);
  });

});
