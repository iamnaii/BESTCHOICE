import {
  isAssignablePermissionKey,
  type AccessGrant,
  type AccessScope,
  type Company,
  type EmployeeAccessContext,
  type PermissionDefinition,
  type PermissionKey,
} from '@installment/shared';
import type { AccessEmployee, AccessPosition, Assignment, PositionInput } from './api';

export const WORK_NAMES: Record<Company, string> = {
  SHOP: 'งานหน้าร้าน',
  FINANCE: 'งานการเงิน',
};
export const SCOPE_NAMES: Record<AccessScope, string> = {
  BRANCHES: 'เฉพาะสาขาที่เลือก',
  ASSIGNED: 'เฉพาะรายการที่ได้รับมอบหมาย',
  COMPANY: 'ทุกสาขาในส่วนงาน',
};
export const SCOPES: AccessScope[] = ['BRANCHES', 'ASSIGNED', 'COMPANY'];

export function comparePermissions(before: readonly PermissionKey[], after: readonly PermissionKey[]) {
  const previous = new Set(before);
  const next = new Set(after);
  return {
    added: [...next].filter((permission) => !previous.has(permission)),
    removed: [...previous].filter((permission) => !next.has(permission)),
  };
}

export function clonePosition(original: AccessPosition, positions: AccessPosition[]): PositionInput {
  const existing = new Set(positions.map((position) => position.code));
  let suffix = '_COPY';
  let code = original.code.slice(0, 64 - suffix.length) + suffix;
  for (let counter = 2; existing.has(code); counter += 1) {
    suffix = `_COPY_${counter}`;
    code = original.code.slice(0, 64 - suffix.length) + suffix;
  }
  return {
    code,
    name: `${original.name.slice(0, 113)} (สำเนา)`,
    permissions: original.permissions.filter(isAssignablePermissionKey),
  };
}

export function branchOptions(context: EmployeeAccessContext, company: Company) {
  // FINANCE can scope an originating SHOP branch while the grant remains FINANCE.
  return context.branches.filter((branch) => branch.companyCode === company || company === 'FINANCE');
}

export function canAssignPosition(position: Pick<AccessPosition, 'isActive' | 'code'>) {
  return position.isActive && position.code !== 'OWNER';
}

export function savedAssignments(employee: AccessEmployee): Assignment[] {
  return employee.accessAssignments.map((row) => ({
    positionId: row.positionId,
    company: row.companyCode,
    scope: row.scope,
    branchIds: row.branches.map(({ branchId }) => branchId),
  }));
}

export function assignmentKey({ positionId, company, scope, branchIds }: AssignableScope) {
  return JSON.stringify([positionId, company, scope, [...branchIds].sort()]);
}

type AssignableScope = Pick<AccessGrant, 'positionId' | 'company' | 'scope' | 'branchIds'>;

export function assignmentProblems(
  assignments: Assignment[],
  positions: AccessPosition[],
  context: EmployeeAccessContext,
) {
  const allowedPositions = new Set(positions.filter(canAssignPosition).map(({ id }) => id));
  const result: string[] = [];
  const seen = new Set<string>();
  assignments.forEach(({ positionId, company, scope, branchIds }, index) => {
    const prefix = `การมอบหมายที่ ${index + 1}`;
    const eligible = new Set(branchOptions(context, company).map(({ id }) => id));
    const key = assignmentKey({ positionId, company, scope, branchIds });
    if (!allowedPositions.has(positionId)) result.push(`${prefix} ต้องเลือกตำแหน่งที่เปิดใช้งาน`);
    if (!context.companies.includes(company)) result.push(`${prefix} ต้องเลือกส่วนงานที่เปิดใช้งาน`);
    if (scope === 'BRANCHES' && branchIds.length === 0) result.push(`${prefix} ต้องเลือกอย่างน้อย 1 สาขา`);
    if (branchIds.some((id) => !eligible.has(id)))
      result.push(`${prefix} มีสาขาที่ปิดหรือใช้กับส่วนงานนี้ไม่ได้`);
    if (scope === 'COMPANY' && branchIds.length) result.push(`${prefix} แบบทุกสาขาต้องไม่มีสาขาที่เลือก`);
    if (seen.has(key)) result.push(`${prefix} ซ้ำกับการมอบหมายอื่น`);
    seen.add(key);
  });
  return result;
}

export function proposedGrants(assignments: Assignment[], positions: AccessPosition[]): AccessGrant[] {
  const permissions = new Map(
    positions
      .filter(canAssignPosition)
      .map((position) => [position.id, position.permissions.filter(isAssignablePermissionKey)]),
  );
  return assignments.map((assignment) => ({
    ...assignment,
    permissions: permissions.get(assignment.positionId) ?? [],
  }));
}

const READ_DEPENDENCIES = {
  'sales.create': 'sales.read',
  'customers.update': 'customers.read',
  'contracts.update': 'contracts.read',
} as const satisfies Partial<Record<PermissionKey, PermissionKey>>;

export function permissionAdvisories(
  permissions: readonly PermissionKey[],
  catalog: readonly PermissionDefinition[],
) {
  return Object.entries(READ_DEPENDENCIES).flatMap(([key, dependency]) => {
    const permission = catalog.find((entry) => entry.key === key)?.key;
    return permission && permissions.includes(permission) && !permissions.includes(dependency)
      ? [{ permission, dependency }]
      : [];
  });
}
