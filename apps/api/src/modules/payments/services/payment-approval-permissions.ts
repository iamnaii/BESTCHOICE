import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';

export const PAYMENT_APPROVAL_PERMISSIONS = [
  'WAIVE_LATE_FEE',
  'PAYMENT_TOLERANCE',
  'VOID_RECEIPT',
  'EARLY_PAYOFF',
  'REFUND',
] as const;

export type PaymentApprovalPermission = typeof PAYMENT_APPROVAL_PERMISSIONS[number];
export const PAYMENT_APPROVAL_PERMISSIONS_KEY = 'payment_approval_permissions';
export const PAYMENT_APPROVAL_USER_ROLES: UserRole[] = [
  UserRole.OWNER,
  UserRole.FINANCE_MANAGER,
  UserRole.BRANCH_MANAGER,
  UserRole.ACCOUNTANT,
  UserRole.SALES,
];

export type PaymentApprovalPermissionsClient = Pick<Prisma.TransactionClient, 'user' | 'systemConfig'>;
export type PaymentApprovalPermissionsMap = Record<string, PaymentApprovalPermission[]>;
export interface ResolvedPaymentApprovalPermissions {
  user: { id: string; name: string; role: UserRole; branchId: string | null };
  permissions: PaymentApprovalPermission[];
}

/** A missing or malformed policy grants nothing. No role-based manager fallback. */
export function parsePaymentApprovalPermissions(value: string | null | undefined): PaymentApprovalPermissionsMap {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const entries = Object.entries(parsed);
  if (entries.some(([, permissions]) => !Array.isArray(permissions) || permissions.some(
    (permission: unknown) => typeof permission !== 'string' ||
      !(PAYMENT_APPROVAL_PERMISSIONS as readonly string[]).includes(permission),
  ))) return {};
  return Object.fromEntries(entries.map(([userId, permissions]) => [
    userId,
    PAYMENT_APPROVAL_PERMISSIONS.filter((permission) => permissions.includes(permission)),
  ]));
}

/** Always resolve the authenticated actor from current database state, including OWNER. */
export async function getPaymentApprovalPermissions(
  client: PaymentApprovalPermissionsClient,
  userId: string,
): Promise<ResolvedPaymentApprovalPermissions> {
  if (!userId) throw new ForbiddenException('ไม่พบผู้ใช้ที่มีสถานะใช้งาน');
  const user = await client.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    select: { id: true, name: true, role: true, branchId: true },
  });
  if (!user) throw new ForbiddenException('ไม่พบผู้ใช้ที่มีสถานะใช้งาน');
  if (user.role === UserRole.OWNER) {
    return { user, permissions: [...PAYMENT_APPROVAL_PERMISSIONS] };
  }
  if (!PAYMENT_APPROVAL_USER_ROLES.includes(user.role)) return { user, permissions: [] };
  const config = await client.systemConfig.findFirst({
    where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY, deletedAt: null },
    select: { value: true },
  });
  const assignments = parsePaymentApprovalPermissions(config?.value);
  return {
    user,
    permissions: Object.prototype.hasOwnProperty.call(assignments, user.id) ? assignments[user.id] : [],
  };
}

export async function assertPaymentApprovalPermission(
  client: PaymentApprovalPermissionsClient,
  userId: string,
  permission: PaymentApprovalPermission,
): Promise<ResolvedPaymentApprovalPermissions> {
  const resolved = await getPaymentApprovalPermissions(client, userId);
  if (!resolved.permissions.includes(permission)) {
    throw new ForbiddenException('ไม่มีสิทธิ์อนุมัติรายการรับชำระประเภทนี้');
  }
  return resolved;
}
