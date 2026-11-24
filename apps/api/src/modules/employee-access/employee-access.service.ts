import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AccessPosition, Prisma } from '@prisma/client';
import {
  DEFAULT_ACCESS_POSITIONS,
  PERMISSION_CATALOG,
  isAssignablePermissionKey,
  resolveCompanyAccess,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AccessClient,
  AccessSnapshotService,
  assertActiveStaff,
  branchCompanyCodesForAccess,
  assertCurrentOwner,
  lockEmployeeAccess,
} from './access-snapshot.service';
import {
  AccessAssignmentDto,
  CreateAccessPositionDto,
  ReplaceAccessAssignmentsDto,
  UpdateAccessPositionDto,
} from './employee-access.dto';

const LEGACY_GRANT_KEYS = ['accounting_permissions', 'payment_approval_permissions'];
const STAFF_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  branchId: true,
  isActive: true,
  accessManaged: true,
  accessRevision: true,
  accessibleCompanies: true,
  primaryCompany: true,
  canReverseOverride: true,
} as const;

function revisionMatches(actual: number, expected: number) {
  if (!Number.isInteger(expected) || expected < 0)
    throw new BadRequestException('กรุณาระบุรุ่นข้อมูลที่ถูกต้อง');
  if (actual !== expected)
    throw new ConflictException('ข้อมูลสิทธิ์มีการเปลี่ยนแปลง กรุณาโหลดใหม่ก่อนบันทึก');
}
function validatePermissions(permissions: string[]) {
  if (
    !Array.isArray(permissions) ||
    permissions.some((p) => !isAssignablePermissionKey(p)) ||
    new Set(permissions).size !== permissions.length
  ) {
    throw new BadRequestException(
      'พบสิทธิ์ที่ไม่รู้จัก ซ้ำ หรือเป็นสิทธิ์สงวนของเจ้าของ/พนักงานทุกคน',
    );
  }
}
function parseGrantMap(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* reject below */
  }
  return null;
}

async function readLegacyGrantMaps(tx: AccessClient) {
  const configs = await tx.systemConfig.findMany({
    where: { key: { in: LEGACY_GRANT_KEYS }, deletedAt: null },
    select: { id: true, key: true, value: true },
    orderBy: { key: 'asc' },
  });
  return configs.map(({ id, key, value }) => ({ id, key, entries: parseGrantMap(value) }));
}

function legacyGrantReview(
  user: { id: string; canReverseOverride: boolean | null },
  configs: Awaited<ReturnType<typeof readLegacyGrantMaps>>,
) {
  const removedLegacyGrants: Record<string, unknown> = { canReverseOverride: user.canReverseOverride };
  const personalGrants: Record<string, unknown> = { ...removedLegacyGrants };
  const warnings: string[] = [];
  for (const { key, entries } of configs) {
    if (!entries) {
      personalGrants[key] = null;
      warnings.push(`ต้องตรวจสอบข้อมูล ${key} ที่อ่านไม่ได้`);
      continue;
    }
    const present = Object.prototype.hasOwnProperty.call(entries, user.id);
    if (present) removedLegacyGrants[key] = entries[user.id];
    personalGrants[key] = present ? entries[user.id] ?? [] : [];
  }
  // Hash exactly what cleanup would remove, in fixed config-key order. Changes to
  // another employee (including creating a map without this employee) are irrelevant.
  const fingerprint = warnings.length ? null : createHash('sha256')
    .update(JSON.stringify([user.id, removedLegacyGrants]))
    .digest('hex');
  return { removedLegacyGrants, personalGrants, warnings, fingerprint };
}

@Injectable()
export class EmployeeAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: AccessSnapshotService,
  ) {}

  private async ownerMutation<T>(
    actorId: string,
    fn: (tx: AccessClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockEmployeeAccess(tx);
        await assertCurrentOwner(tx, actorId);
        return fn(tx);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException('ข้อมูลซ้ำหรือมีผู้แก้ไขพร้อมกัน กรุณาโหลดข้อมูลใหม่');
      }
      throw error;
    }
  }

  private audit(
    tx: AccessClient,
    actorId: string,
    action: string,
    entity: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
  ) {
    // Existing chain verification accepts null-chain rows. Await in the same mutation transaction.
    return tx.auditLog.create({
      data: {
        userId: actorId,
        action,
        entity,
        entityId,
        oldValue: oldValue == null ? Prisma.JsonNull : JSON.parse(JSON.stringify(oldValue)),
        newValue: newValue == null ? Prisma.JsonNull : JSON.parse(JSON.stringify(newValue)),
      },
    });
  }

  async catalog(actorId: string) {
    await this.snapshots.forUser(actorId);
    return {
      permissions: PERMISSION_CATALOG,
      templates: DEFAULT_ACCESS_POSITIONS,
      scopes: ['BRANCHES', 'ASSIGNED', 'COMPANY'],
      companies: ['SHOP', 'FINANCE'],
    };
  }

  async positions(actorId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await assertCurrentOwner(tx, actorId);
        const positions = await tx.accessPosition.findMany({
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
        });
        return Promise.all(
          positions.map(async (position) => ({
            ...position,
            affectedEmployeeCount: await this.affectedCount(tx, position.id),
          })),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async affectedCount(tx: AccessClient, positionId: string) {
    const assignments = await tx.employeeAccessAssignment.findMany({
      where: { positionId, deletedAt: null, user: { deletedAt: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return assignments.length;
  }

  async createPosition(actorId: string, dto: CreateAccessPositionDto) {
    return this.ownerMutation(actorId, async (tx) => {
      validatePermissions(dto.permissions);
      if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(dto.code) || dto.code === 'OWNER' || !dto.name?.trim())
        throw new BadRequestException(
          'รหัสหรือชื่อตำแหน่งไม่ถูกต้อง หรือเป็นตำแหน่งเจ้าของที่สงวนไว้',
        );
      const position = await tx.accessPosition.create({
        data: { code: dto.code, name: dto.name.trim(), permissions: dto.permissions },
      });
      await this.audit(
        tx,
        actorId,
        'ACCESS_POSITION_CREATED',
        'access_position',
        position.id,
        null,
        position,
      );
      return { ...position, affectedEmployeeCount: 0 };
    });
  }

  /** Explicit owner action only. Repeated calls never overwrite owner-edited templates. */
  async seedTemplates(actorId: string) {
    return this.ownerMutation(actorId, async (tx) => {
      const created: AccessPosition[] = [];
      for (const template of DEFAULT_ACCESS_POSITIONS.filter((p) => p.assignable)) {
        if (await tx.accessPosition.findUnique({ where: { code: template.code } })) continue;
        created.push(
          await tx.accessPosition.create({
            data: {
              code: template.code,
              name: template.name,
              permissions: [...template.permissions],
            },
          }),
        );
      }
      if (created.length)
        await this.audit(
          tx,
          actorId,
          'ACCESS_TEMPLATES_CREATED',
          'access_position',
          'templates',
          null,
          created,
        );
      return { createdCount: created.length, affectedEmployeeCount: 0 };
    });
  }

  async updatePosition(actorId: string, id: string, dto: UpdateAccessPositionDto) {
    return this.ownerMutation(actorId, async (tx) => {
      const current = await tx.accessPosition.findUnique({ where: { id } });
      if (!current || current.deletedAt) throw new NotFoundException('ไม่พบตำแหน่ง');
      revisionMatches(current.revision, dto.expectedRevision);
      if (current.code === 'OWNER')
        throw new BadRequestException('ไม่สามารถแก้ไขตำแหน่งเจ้าของได้');
      if (dto.permissions !== undefined) validatePermissions(dto.permissions);
      if (dto.name !== undefined && (typeof dto.name !== 'string' || !dto.name.trim()))
        throw new BadRequestException('กรุณาระบุชื่อตำแหน่ง');
      if (
        (dto.isActive !== undefined && typeof dto.isActive !== 'boolean') ||
        (dto.deleted !== undefined && typeof dto.deleted !== 'boolean')
      )
        throw new BadRequestException('สถานะตำแหน่งไม่ถูกต้อง');
      const affectedEmployeeCount = await this.affectedCount(tx, id);
      if (dto.expectedAffectedEmployeeCount !== undefined) {
        if (
          !Number.isInteger(dto.expectedAffectedEmployeeCount) || dto.expectedAffectedEmployeeCount < 0
        )
          throw new BadRequestException('จำนวนพนักงานที่ตรวจสอบไม่ถูกต้อง');
        if (affectedEmployeeCount !== dto.expectedAffectedEmployeeCount)
          throw new ConflictException('จำนวนพนักงานที่ได้รับมอบหมายเปลี่ยนแปลง กรุณาโหลดใหม่ก่อนบันทึก');
      }
      const changed = await tx.accessPosition.updateMany({
        where: { id, revision: dto.expectedRevision },
        data: {
          name: dto.name?.trim(),
          permissions: dto.permissions,
          isActive: dto.deleted ? false : dto.isActive,
          deletedAt: dto.deleted ? new Date() : undefined,
          revision: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('ข้อมูลตำแหน่งเปลี่ยนแปลง กรุณาโหลดใหม่');
      await tx.user.updateMany({
        where: { accessAssignments: { some: { positionId: id, deletedAt: null } } },
        data: { accessRevision: { increment: 1 } },
      });
      const position = await tx.accessPosition.findUniqueOrThrow({ where: { id } });
      await this.audit(tx, actorId, 'ACCESS_POSITION_UPDATED', 'access_position', id, current, {
        ...position,
        affectedEmployeeCount,
      });
      return { ...position, affectedEmployeeCount };
    });
  }

  private async validateAssignment(tx: AccessClient, assignment: AccessAssignmentDto) {
    const { company, scope, branchIds } = assignment;
    if (
      !['SHOP', 'FINANCE'].includes(company) ||
      !['BRANCHES', 'ASSIGNED', 'COMPANY'].includes(scope) ||
      !Array.isArray(branchIds) ||
      new Set(branchIds).size !== branchIds.length ||
      (scope === 'BRANCHES' && !branchIds.length) ||
      (scope === 'COMPANY' && branchIds.length)
    ) {
      throw new BadRequestException('งาน ขอบเขต หรือสาขาไม่ถูกต้อง');
    }
    const position = await tx.accessPosition.findUnique({ where: { id: assignment.positionId } });
    if (position && assignment.expectedPositionRevision !== undefined)
      revisionMatches(position.revision, assignment.expectedPositionRevision);
    if (!position || !position.isActive || position.deletedAt || position.code === 'OWNER')
      throw new BadRequestException('ตำแหน่งไม่พร้อมใช้งานหรือไม่สามารถมอบหมายได้');
    const activeCompany = await tx.companyInfo.findFirst({
      where: { companyCode: company, isActive: true, deletedAt: null },
    });
    if (!activeCompany) throw new BadRequestException('ไม่พบส่วนงานที่เปิดใช้งาน');
    const branches = await tx.branch.findMany({
      where: {
        id: { in: branchIds },
        isActive: true,
        deletedAt: null,
        company: {
          companyCode: { in: branchCompanyCodesForAccess(company) },
          isActive: true,
          deletedAt: null,
        },
      },
      select: { id: true },
    });
    if (branches.length !== branchIds.length)
      throw new BadRequestException('สาขาไม่พร้อมใช้งานหรือไม่อยู่ในส่วนงานที่เลือก');
  }

  async replaceAssignments(actorId: string, userId: string, dto: ReplaceAccessAssignmentsDto) {
    return this.ownerMutation(actorId, async (tx) => {
      // A legacy reversal edit updates the user directly. Lock before reading it.
      await tx.$executeRaw`SELECT id FROM users WHERE id = ${userId} FOR NO KEY UPDATE`;
      const user = await assertActiveStaff(tx, userId);
      if (user.role === 'OWNER')
        throw new ForbiddenException('ไม่สามารถมอบหมายตำแหน่งให้บัญชีเจ้าของได้');
      revisionMatches(user.accessRevision, dto.expectedRevision);
      for (const assignment of dto.assignments) await this.validateAssignment(tx, assignment);
      const keys = dto.assignments.map((a) =>
        JSON.stringify([a.positionId, a.company, a.scope, [...a.branchIds].sort()]),
      );
      if (new Set(keys).size !== keys.length)
        throw new BadRequestException('รายการมอบหมายตำแหน่งซ้ำกัน');
      // The settings writers use these per-key locks even for a first-time upsert.
      // Keep the global access → user → ordered config lock order until commit.
      for (const key of LEGACY_GRANT_KEYS)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      await tx.$executeRaw`SELECT key FROM system_config WHERE key IN ('accounting_permissions', 'payment_approval_permissions') ORDER BY key FOR UPDATE`;
      const configs = await readLegacyGrantMaps(tx);
      const { fingerprint, removedLegacyGrants } = legacyGrantReview(user, configs);
      if (fingerprint === null)
        throw new ConflictException('ข้อมูลสิทธิ์รายบุคคลเดิมไม่ถูกต้อง กรุณาตรวจสอบก่อนย้ายสิทธิ์');
      if (dto.expectedLegacyGrantsFingerprint !== undefined && fingerprint !== dto.expectedLegacyGrantsFingerprint)
        throw new ConflictException('สิทธิ์รายบุคคลเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
      const before = await tx.employeeAccessAssignment.findMany({
        where: { userId, deletedAt: null },
        include: { branches: true },
      });
      const changed = await tx.user.updateMany({
        where: { id: userId, accessRevision: dto.expectedRevision },
        data: { accessManaged: true, accessRevision: { increment: 1 }, canReverseOverride: null },
      });
      if (changed.count !== 1)
        throw new ConflictException('ข้อมูลพนักงานเปลี่ยนแปลง กรุณาโหลดใหม่');
      for (const { id, key, entries } of configs) {
        if (!entries || !Object.prototype.hasOwnProperty.call(removedLegacyGrants, key)) continue;
        delete entries[userId];
        await tx.systemConfig.update({
          where: { id },
          data: { value: JSON.stringify(entries) },
        });
      }
      await tx.employeeAccessAssignment.updateMany({
        where: { userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      const assignments: AccessAssignmentDto[] = [];
      for (const { positionId, company, scope, branchIds } of dto.assignments) {
        await tx.employeeAccessAssignment.create({
          data: {
            userId,
            positionId,
            companyCode: company,
            scope,
            branches: { create: branchIds.map((branchId) => ({ branchId })) },
          },
        });
        assignments.push({ positionId, company, scope, branchIds });
      }
      const snapshot = await this.snapshots.forUserInTransaction(tx, userId);
      // Effective grants may exclude saved tuples if branch or company status changes.
      await this.audit(
        tx,
        actorId,
        'ACCESS_ASSIGNMENTS_REPLACED',
        'user',
        userId,
        {
          managed: user.accessManaged,
          revision: user.accessRevision,
          assignments: before,
          removedLegacyGrants,
        },
        { ...snapshot, assignments },
      );
      return { ...snapshot, affectedEmployeeCount: 1, removedLegacyGrants };
    });
  }

  async employees(actorId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await assertCurrentOwner(tx, actorId);
        return tx.user.findMany({
          where: { deletedAt: null, isSystemUser: false },
          select: {
            ...STAFF_SELECT,
            accessAssignments: {
              where: { deletedAt: null },
              include: { position: true, branches: { select: { branchId: true } } },
            },
          },
          orderBy: { name: 'asc' },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async migrationPreview(actorId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await assertCurrentOwner(tx, actorId);
        const users = await tx.user.findMany({
          where: { deletedAt: null, isSystemUser: false },
          select: STAFF_SELECT,
          orderBy: { name: 'asc' },
        });
        const configs = await readLegacyGrantMaps(tx);
        return users.map((user) => {
          const companyAccess = resolveCompanyAccess(
            user.role,
            user.accessibleCompanies,
            user.primaryCompany,
          );
          const template = DEFAULT_ACCESS_POSITIONS.find(
            (position) => position.assignable && position.code === user.role,
          );
          const review = legacyGrantReview(user, configs);
          return {
            ...user,
            managed: user.accessManaged,
            isOwner: user.role === 'OWNER',
            proposedPositionCode: template?.code ?? null,
            proposedCompanies: [...companyAccess.accessible],
            proposedBranchIds: user.branchId ? [user.branchId] : [],
            proposedScope: user.branchId ? 'BRANCHES' : null,
            personalGrants: review.personalGrants,
            legacyGrantsFingerprint: review.fingerprint,
            warnings: ['ต้องให้เจ้าของตรวจสอบหน้าที่จริงและยืนยันขอบเขตก่อนเปิดใช้', ...review.warnings],
            requiresReview: true,
            // Names and legacy roles are suggestions only; no automatic company-wide grant.
            reservedRightsRemoved:
              user.role === 'OWNER'
                ? []
                : [
                    'sales.cancel.approve',
                    'refunds.approve',
                    'interest-reductions.approve',
                    'penalty-waivers.approve',
                  ],
          };
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
