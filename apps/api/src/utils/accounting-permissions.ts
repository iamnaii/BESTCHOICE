import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { hasCrossBranchAccess } from '../modules/auth/branch-access.util';

export const ACCOUNTING_PERMISSIONS = [
  'EXPENSE_POST', 'EXPENSE_APPROVE', 'EXPENSE_CANCEL',
  'INCOME_POST', 'INCOME_APPROVE', 'INCOME_CANCEL',
] as const;

export type AccountingPermission = typeof ACCOUNTING_PERMISSIONS[number];
export const ACCOUNTING_PERMISSIONS_KEY = 'accounting_permissions';
export const ACCOUNTING_USER_ROLES: UserRole[] = [
  UserRole.OWNER,
  UserRole.FINANCE_MANAGER,
  UserRole.BRANCH_MANAGER,
  UserRole.ACCOUNTANT,
];

export type AccountingPermissionsClient = Pick<Prisma.TransactionClient, 'user' | 'systemConfig'>;
export type AccountingPermissionsMap = Record<string, AccountingPermission[]>;
export interface ResolvedAccountingPermissions {
  user: { id: string; name: string; role: UserRole; branchId: string | null };
  permissions: AccountingPermission[];
}

/** A missing or malformed policy grants nothing. No role-based manager fallback. */
export function parseAccountingPermissions(value: string | null | undefined): AccountingPermissionsMap {
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
      !(ACCOUNTING_PERMISSIONS as readonly string[]).includes(permission),
  ))) return {};
  return Object.fromEntries(entries.map(([userId, permissions]) => [
    userId,
    ACCOUNTING_PERMISSIONS.filter((permission) => permissions.includes(permission)),
  ]));
}

/** Always resolve the authenticated actor from current database state, including OWNER. */
export async function getAccountingPermissions(
  client: AccountingPermissionsClient,
  userId: string,
): Promise<ResolvedAccountingPermissions> {
  if (!userId) throw new ForbiddenException('ไม่พบผู้ใช้ที่มีสถานะใช้งาน');
  const user = await client.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null, isSystemUser: false },
    select: { id: true, name: true, role: true, branchId: true },
  });
  if (!user) throw new ForbiddenException('ไม่พบผู้ใช้ที่มีสถานะใช้งาน');
  if (user.role === UserRole.OWNER) {
    return { user, permissions: [...ACCOUNTING_PERMISSIONS] };
  }
  if (!ACCOUNTING_USER_ROLES.includes(user.role)) return { user, permissions: [] };
  const config = await client.systemConfig.findFirst({
    where: { key: ACCOUNTING_PERMISSIONS_KEY, deletedAt: null },
    select: { value: true },
  });
  const assignments = parseAccountingPermissions(config?.value);
  return {
    user,
    permissions: (Object.prototype.hasOwnProperty.call(assignments, user.id) ? assignments[user.id] : [])
      .filter((permission) => canAssignAccountingPermission(user.role, permission)),
  };
}

export async function assertAccountingPermission(
  client: AccountingPermissionsClient,
  userId: string,
  permission: AccountingPermission,
): Promise<ResolvedAccountingPermissions> {
  const resolved = await getAccountingPermissions(client, userId);
  if (!resolved.permissions.includes(permission)) {
    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการรายการบัญชีประเภทนี้');
  }
  return resolved;
}

/** Existing module access: branch managers operate expense documents in their branch. */
export function canAssignAccountingPermission(role: string, permission: AccountingPermission): boolean {
  return ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(role) ||
    (role === 'BRANCH_MANAGER' && permission.startsWith('EXPENSE_'));
}

export function assertAccountingBranch(user: { role: string; branchId: string | null }, branchId: string | null): void {
  if (hasCrossBranchAccess(user)) return;
  if (!user.branchId || user.branchId !== branchId) {
    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการเอกสารต่างสาขา');
  }
}
