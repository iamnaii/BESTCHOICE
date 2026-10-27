import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AccessSnapshot,
  AccessResource,
  PermissionKey,
  canAccess,
  isAssignablePermissionKey,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';

export type AccessClient = Prisma.TransactionClient;

/** FINANCE scopes can refer to the originating SHOP branch; this never changes grant.company. */
export function branchCompanyCodesForAccess(company: string): string[] {
  return company === 'FINANCE' ? ['SHOP', 'FINANCE'] : company === 'SHOP' ? ['SHOP'] : [];
}

/** Serialize privilege edits and owner status changes, including concurrent last-owner removals. */
export async function lockEmployeeAccess(tx: AccessClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
}

export async function assertActiveStaff(tx: AccessClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    !user.isActive ||
    user.deletedAt ||
    user.isSystemUser ||
    !['OWNER', 'SALES', 'BRANCH_MANAGER', 'ACCOUNTANT', 'FINANCE_MANAGER', 'VIEWER'].includes(
      user.role,
    )
  ) {
    throw new ForbiddenException('ไม่พบบัญชีพนักงานที่เปิดใช้งาน');
  }
  return user;
}

export async function assertCurrentOwner(tx: AccessClient, userId: string) {
  const user = await assertActiveStaff(tx, userId);
  if (user.role !== 'OWNER') throw new ForbiddenException('เฉพาะเจ้าของเท่านั้นที่จัดการสิทธิ์ได้');
  return user;
}

/** Call after lockEmployeeAccess and before an account role/status/deletion mutation. */
export async function assertNotLastOwner(
  tx: AccessClient,
  userId: string,
  next: { role?: string; isActive?: boolean; deletedAt?: Date | null },
): Promise<void> {
  const current = await tx.user.findUnique({ where: { id: userId } });
  if (
    !current ||
    current.role !== 'OWNER' ||
    !current.isActive ||
    current.deletedAt ||
    current.isSystemUser
  )
    return;
  if (
    (next.role === undefined || next.role === 'OWNER') &&
    next.isActive !== false &&
    !next.deletedAt
  )
    return;
  const others = await tx.user.count({
    where: {
      id: { not: userId },
      role: 'OWNER',
      isActive: true,
      deletedAt: null,
      isSystemUser: false,
    },
  });
  if (others === 0)
    throw new ForbiddenException('ไม่สามารถปิดใช้งานหรือลดสิทธิ์เจ้าของคนสุดท้ายได้');
}

@Injectable()
export class AccessSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string): Promise<AccessSnapshot> {
    // The account, position and branch states must describe one database snapshot.
    return this.prisma.$transaction((tx) => this.forUserInTransaction(tx, userId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  async forUserInTransaction(tx: AccessClient, userId: string): Promise<AccessSnapshot> {
    const user = await assertActiveStaff(tx, userId);
    const snapshot: AccessSnapshot = {
      userId: user.id,
      isOwner: user.role === 'OWNER',
      managed: user.accessManaged,
      revision: user.accessRevision,
      grants: [],
    };
    if (!user.accessManaged) return snapshot;
    const assignments = await tx.employeeAccessAssignment.findMany({
      where: {
        userId,
        deletedAt: null,
        position: { isActive: true, deletedAt: null },
        company: { isActive: true, deletedAt: null },
      },
      include: {
        position: true,
        branches: { include: { branch: { include: { company: true } } } },
      },
      orderBy: { id: 'asc' },
    });
    return {
      ...snapshot,
      grants: assignments.flatMap((assignment) => {
        if (
          !['SHOP', 'FINANCE'].includes(assignment.companyCode) ||
          assignment.position.code === 'OWNER'
        )
          return [];
        const branchIds = assignment.branches
          .filter(
            ({ branch }) =>
              branch.isActive &&
              !branch.deletedAt &&
              branchCompanyCodesForAccess(assignment.companyCode).includes(
                branch.company?.companyCode ?? '',
              ) &&
              branch.company?.isActive &&
              !branch.company?.deletedAt,
          )
          .map(({ branchId }) => branchId);
        // Never turn a formerly branch-limited ASSIGNED grant into unrestricted assigned scope.
        if (assignment.branches.length !== branchIds.length) return [];
        if (assignment.scope === 'BRANCHES' && !branchIds.length) return [];
        if (assignment.scope === 'COMPANY' && branchIds.length) return [];
        return [
          {
            positionId: assignment.positionId,
            permissions: assignment.position.permissions.filter(isAssignablePermissionKey),
            company: assignment.companyCode as 'SHOP' | 'FINANCE',
            scope: assignment.scope,
            branchIds,
          },
        ];
      }),
    };
  }

  /** Reserved OCR needs current owner identity, not its unrelated assignment graph.
   * Caller holds the same authority locks as the full snapshot path. */
  async forOwnerInTransaction(tx: AccessClient, userId: string): Promise<AccessSnapshot> {
    const user = await assertCurrentOwner(tx, userId);
    return {
      userId: user.id,
      isOwner: true,
      managed: user.accessManaged,
      revision: user.accessRevision,
      grants: [],
    };
  }

  async assertInTransaction(
    tx: AccessClient,
    userId: string,
    permission: PermissionKey,
    resource: AccessResource,
  ) {
    const snapshot = await this.forUserInTransaction(tx, userId);
    if (!canAccess(snapshot, permission, resource))
      throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการในขอบเขตนี้');
    return snapshot;
  }
}
