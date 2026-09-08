import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SettingsWriteService } from '../../settings/services/settings-write.service';
import { UpdatePaymentApprovalSettingsDto } from '../dto/update-payment-approval-settings.dto';
import { PaymentsApprovalSettingsController } from '../payments-approval-settings.controller';
import { PaymentApprovalSettingsService } from './payment-approval-settings.service';
import {
  PAYMENT_APPROVAL_PERMISSIONS,
  PAYMENT_APPROVAL_PERMISSIONS_KEY,
} from './payment-approval-permissions';

const OWNER = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-000000000002';

describe('payment approval settings', () => {
  let state: string;
  let db: any;
  let audit: { log: jest.Mock };
  let service: PaymentApprovalSettingsService;
  const users = [
    { id: OWNER, name: 'เจ้าของ', role: 'OWNER', branchId: null },
    { id: STAFF, name: 'ฝ่ายขาย', role: 'SALES', branchId: 'branch' },
  ];

  beforeEach(() => {
    state = JSON.stringify({ [STAFF]: ['WAIVE_LATE_FEE'] });
    db = {
      user: {
        findFirst: jest.fn().mockResolvedValue(users[0]),
        findMany: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(users.filter((user) => !where.id || where.id.in.includes(user.id))),
          ),
      },
      systemConfig: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve({ value: state })),
        upsert: jest.fn().mockImplementation(({ update }) => {
          state = update.value;
          return Promise.resolve({ value: state });
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue([]),
    };
    db.$transaction = jest.fn((fn) => fn(db));
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new PaymentApprovalSettingsService(db as PrismaService);
  });

  it('lists OWNER rights and only configured staff grants without returning contact details', async () => {
    const result = await service.getSettings(OWNER);
    expect(result.users).toEqual([
      expect.objectContaining({ id: OWNER, permissions: [...PAYMENT_APPROVAL_PERMISSIONS] }),
      expect.objectContaining({ id: STAFF, permissions: ['WAIVE_LATE_FEE'] }),
    ]);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true, deletedAt: null, isSystemUser: false }),
        select: { id: true, name: true, role: true },
      }),
    );
  });

  it('rejects a staff actor even if its stale token could claim OWNER', async () => {
    db.user.findFirst.mockResolvedValue(users[1]);
    await expect(service.updateSettings({ users: [] }, STAFF)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('rejects deactivated or deleted actors before changing permissions', async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(service.updateSettings({ users: [] }, OWNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('replaces grants and audits the exact old and new policy', async () => {
    const result = await service.updateSettings(
      { users: [{ userId: STAFF, permissions: ['REFUND'] }] },
      OWNER,
    );
    expect(result.users.find((user) => user.id === STAFF)?.permissions).toEqual(['REFUND']);
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: OWNER,
        entityId: PAYMENT_APPROVAL_PERMISSIONS_KEY,
        oldValue: { permissions: { [STAFF]: ['WAIVE_LATE_FEE'] } },
        newValue: { permissions: { [STAFF]: ['REFUND'] } },
      }),
    });
  });

  it('revokes all explicit grants with an empty replacement without removing OWNER rights', async () => {
    const result = await service.updateSettings({ users: [] }, OWNER);
    expect(JSON.parse(state)).toEqual({});
    expect(result.users.find((user) => user.id === STAFF)?.permissions).toEqual([]);
    expect(result.users.find((user) => user.id === OWNER)?.permissions).toEqual([
      ...PAYMENT_APPROVAL_PERMISSIONS,
    ]);
  });

  it('rejects unknown, inactive or deleted targets instead of persisting unusable grants', async () => {
    await expect(
      service.updateSettings({ users: [{ userId: 'missing', permissions: ['REFUND'] }] }, OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { users: [{ userId: 'invalid-id', permissions: ['REFUND'] }] },
    { users: [{ userId: STAFF, permissions: ['UNKNOWN'] }] },
    { users: [{ userId: STAFF, permissions: ['REFUND', 'REFUND'] }] },
    {
      users: [
        { userId: STAFF, permissions: [] },
        { userId: STAFF, permissions: [] },
      ],
    },
    { users: [{ userId: STAFF }] },
    { users: [null] },
  ])('validates malformed settings payload %#', async (payload) => {
    const errors = await validate(plainToInstance(UpdatePaymentApprovalSettingsDto, payload));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('protects both settings endpoints with OWNER role metadata', () => {
    expect(
      Reflect.getMetadata('roles', PaymentsApprovalSettingsController.prototype.getSettings),
    ).toEqual(['OWNER']);
    expect(
      Reflect.getMetadata('roles', PaymentsApprovalSettingsController.prototype.updateSettings),
    ).toEqual(['OWNER']);
  });

  it('blocks bypass through the generic single and bulk configuration writers', async () => {
    const generic = new SettingsWriteService(db as PrismaService, audit as unknown as AuditService);
    await expect(
      generic.update(PAYMENT_APPROVAL_PERMISSIONS_KEY, '{}', OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      generic.bulkUpdate([{ key: PAYMENT_APPROVAL_PERMISSIONS_KEY, value: '{}' }], OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });
});
