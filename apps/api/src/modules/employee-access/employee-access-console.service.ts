import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AccessSnapshot,
  COMPANIES,
  Company,
  EmployeeAccessContext,
  EmployeeAccessHistoryAssignment,
  EmployeeAccessHistoryAssignments,
  EmployeeAccessHistoryItem,
  EmployeeAccessHistoryPage,
  EmployeeAccessHistoryPosition,
  isPermissionKey,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService, assertCurrentOwner } from './access-snapshot.service';
import { EmployeeAccessHistoryQueryDto } from './employee-access.dto';

const HISTORY_WHERE: Prisma.AuditLogWhereInput = {
  OR: [
    {
      entity: 'access_position',
      action: { in: ['ACCESS_POSITION_CREATED', 'ACCESS_POSITION_UPDATED'] },
    },
    { entity: 'access_position', action: 'ACCESS_TEMPLATES_CREATED', entityId: 'templates' },
    { entity: 'user', action: 'ACCESS_ASSIGNMENTS_REPLACED' },
  ],
};

const HISTORY_SELECT = {
  id: true,
  createdAt: true,
  action: true,
  entity: true,
  entityId: true,
  oldValue: true,
  newValue: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogSelect;

type HistoryRow = Prisma.AuditLogGetPayload<{ select: typeof HISTORY_SELECT }>;

function isAccessCompany(value: unknown): value is Company {
  return COMPANIES.some((company) => company === value);
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function projectPosition(value: Prisma.JsonValue): EmployeeAccessHistoryPosition | null {
  const position = jsonObject(value);
  if (!position) return null;
  const { id, code, name, permissions, isActive, revision } = position;
  const safe: EmployeeAccessHistoryPosition = {};
  if (typeof id === 'string') safe.id = id;
  if (typeof code === 'string') safe.code = code;
  if (typeof name === 'string') safe.name = name;
  if (Array.isArray(permissions)) safe.permissions = permissions.filter(isPermissionKey);
  if (typeof isActive === 'boolean') safe.isActive = isActive;
  if (isRevision(revision)) safe.revision = revision;
  return safe;
}

function projectAssignment(value: Prisma.JsonValue): EmployeeAccessHistoryAssignment | null {
  const assignment = jsonObject(value);
  if (!assignment) return null;
  const { positionId, scope } = assignment;
  const company = assignment.company ?? assignment.companyCode;
  if (
    typeof positionId !== 'string' ||
    !isAccessCompany(company) ||
    (scope !== 'BRANCHES' && scope !== 'ASSIGNED' && scope !== 'COMPANY')
  ) {
    return null;
  }
  // Before stores branch join rows. After tuples and legacy grants store branch IDs.
  const branchIds = Array.isArray(assignment.branchIds)
    ? assignment.branchIds
    : Array.isArray(assignment.branches)
      ? assignment.branches.map((branch) => jsonObject(branch)?.branchId)
      : null;
  if (!branchIds || !branchIds.every((id): id is string => typeof id === 'string')) return null;
  return { positionId, company, scope, branchIds };
}

function projectAssignments(value: Prisma.JsonValue): EmployeeAccessHistoryAssignments | null {
  const state = jsonObject(value);
  if (!state) return null;
  const { managed, revision } = state;
  const assignments = state.assignments ?? state.grants;
  const safe: EmployeeAccessHistoryAssignments = {
    assignments: Array.isArray(assignments)
      ? assignments.map(projectAssignment).filter((assignment) => assignment !== null)
      : [],
  };
  if (typeof managed === 'boolean') safe.managed = managed;
  if (isRevision(revision)) safe.revision = revision;
  return safe;
}

function projectHistory(row: HistoryRow): EmployeeAccessHistoryItem | null {
  const { action, entity, entityId, oldValue, newValue, user } = row;
  const header = {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actor: user ? { id: user.id, name: user.name } : null,
    entityId,
  };
  if (entity === 'access_position') {
    if (action === 'ACCESS_POSITION_CREATED' || action === 'ACCESS_POSITION_UPDATED') {
      return {
        ...header,
        action,
        entity,
        before: projectPosition(oldValue),
        after: projectPosition(newValue),
      };
    }
    if (action === 'ACCESS_TEMPLATES_CREATED' && entityId === 'templates') {
      return {
        ...header,
        action,
        entity,
        before: null,
        after: Array.isArray(newValue)
          ? newValue.map(projectPosition).filter((position) => position !== null)
          : [],
      };
    }
  }
  if (entity === 'user' && action === 'ACCESS_ASSIGNMENTS_REPLACED') {
    return {
      ...header,
      action,
      entity,
      before: projectAssignments(oldValue),
      after: projectAssignments(newValue),
    };
  }
  return null;
}

@Injectable()
export class EmployeeAccessConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: AccessSnapshotService,
  ) {}

  async context(actorId: string): Promise<EmployeeAccessContext> {
    return this.prisma.$transaction(
      async (tx) => {
        await assertCurrentOwner(tx, actorId);
        const activeCompany = {
          companyCode: { in: [...COMPANIES] },
          isActive: true,
          deletedAt: null,
        };
        const companies = await tx.companyInfo.findMany({
          where: activeCompany,
          select: { companyCode: true },
        });
        const branches = await tx.branch.findMany({
          where: { isActive: true, deletedAt: null, company: activeCompany },
          select: { id: true, name: true, company: { select: { companyCode: true } } },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
        return {
          companies: COMPANIES.filter((code) =>
            companies.some(({ companyCode }) => companyCode === code),
          ),
          branches: branches.flatMap(({ id, name, company }) => {
            const companyCode = company?.companyCode;
            return isAccessCompany(companyCode) ? [{ id, name, companyCode }] : [];
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async effectiveAccess(actorId: string, userId: string): Promise<AccessSnapshot> {
    return this.prisma.$transaction(
      async (tx) => {
        await assertCurrentOwner(tx, actorId);
        return this.snapshots.forUserInTransaction(tx, userId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async history(
    actorId: string,
    { page = 1, limit = 20 }: EmployeeAccessHistoryQueryDto = {},
  ): Promise<EmployeeAccessHistoryPage> {
    return this.prisma.$transaction(
      async (tx) => {
        await assertCurrentOwner(tx, actorId);
        const total = await tx.auditLog.count({ where: HISTORY_WHERE });
        if (page > Math.ceil(total / limit)) return { items: [], total, page, limit };
        const rows = await tx.auditLog.findMany({
          where: HISTORY_WHERE,
          select: HISTORY_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        });
        return {
          items: rows.map(projectHistory).filter((item) => item !== null),
          total,
          page,
          limit,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
