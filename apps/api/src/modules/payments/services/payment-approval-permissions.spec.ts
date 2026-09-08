import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  assertPaymentApprovalPermission,
  getPaymentApprovalPermissions,
  parsePaymentApprovalPermissions,
  PAYMENT_APPROVAL_PERMISSIONS,
  PaymentApprovalPermissionsClient,
} from './payment-approval-permissions';

describe('payment approval permissions', () => {
  const actor = { id: 'staff', name: 'พนักงาน', role: UserRole.FINANCE_MANAGER, branchId: 'branch' };
  let user: { findFirst: jest.Mock };
  let systemConfig: { findFirst: jest.Mock };
  let client: PaymentApprovalPermissionsClient;

  beforeEach(() => {
    user = { findFirst: jest.fn().mockResolvedValue(actor) };
    systemConfig = { findFirst: jest.fn().mockResolvedValue(null) };
    client = { user, systemConfig } as unknown as PaymentApprovalPermissionsClient;
  });

  it.each([UserRole.FINANCE_MANAGER, UserRole.BRANCH_MANAGER, UserRole.ACCOUNTANT, UserRole.SALES])(
    'does not automatically grant approval to %s', async (role) => {
      user.findFirst.mockResolvedValue({ ...actor, role });
      await expect(assertPaymentApprovalPermission(client, actor.id, 'WAIVE_LATE_FEE')).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('grants only explicitly assigned permission, not another payment action', async () => {
    systemConfig.findFirst.mockResolvedValue({ value: JSON.stringify({ staff: ['WAIVE_LATE_FEE'] }) });
    await expect(assertPaymentApprovalPermission(client, actor.id, 'WAIVE_LATE_FEE')).resolves.toEqual({ user: actor, permissions: ['WAIVE_LATE_FEE'] });
    await expect(assertPaymentApprovalPermission(client, actor.id, 'REFUND')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechecks revocation on the next call without cached approval rights', async () => {
    systemConfig.findFirst.mockResolvedValueOnce({ value: JSON.stringify({ staff: ['VOID_RECEIPT'] }) });
    await expect(assertPaymentApprovalPermission(client, actor.id, 'VOID_RECEIPT')).resolves.toBeDefined();
    await expect(assertPaymentApprovalPermission(client, actor.id, 'VOID_RECEIPT')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a current active undeleted user even when the policy contains their id', async () => {
    user.findFirst.mockResolvedValue(null);
    systemConfig.findFirst.mockResolvedValue({ value: JSON.stringify({ staff: ['REFUND'] }) });
    await expect(getPaymentApprovalPermissions(client, actor.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: actor.id, isActive: true, deletedAt: null } }));
  });

  it('allows an active OWNER all actions based on the database role', async () => {
    user.findFirst.mockResolvedValue({ ...actor, role: UserRole.OWNER });
    await expect(getPaymentApprovalPermissions(client, actor.id)).resolves.toEqual({ user: { ...actor, role: UserRole.OWNER }, permissions: [...PAYMENT_APPROVAL_PERMISSIONS] });
    expect(systemConfig.findFirst).not.toHaveBeenCalled();
  });

  it('does not grant rights to a user whose role became VIEWER', async () => {
    user.findFirst.mockResolvedValue({ ...actor, role: UserRole.VIEWER });
    systemConfig.findFirst.mockResolvedValue({ value: JSON.stringify({ staff: ['REFUND'] }) });
    await expect(getPaymentApprovalPermissions(client, actor.id)).resolves.toMatchObject({ permissions: [] });
  });

  it.each(['broken', '[]', 'null', '{"staff":["UNKNOWN"]}', '{"staff":"REFUND"}'])('fails closed for malformed policy %s', (raw) => {
    expect(parsePaymentApprovalPermissions(raw)).toEqual({});
  });

  it('rejects a missing actor without querying an unscoped user row', async () => {
    await expect(getPaymentApprovalPermissions(client, '')).rejects.toBeInstanceOf(ForbiddenException);
    expect(user.findFirst).not.toHaveBeenCalled();
  });

  it('does not convert a database error into approval', async () => {
    systemConfig.findFirst.mockRejectedValue(new Error('database unavailable'));
    await expect(assertPaymentApprovalPermission(client, actor.id, 'REFUND')).rejects.toThrow('database unavailable');
  });
});
