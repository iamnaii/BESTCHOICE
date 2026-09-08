import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateAccountingSettingsDto } from '../dto/update-accounting-settings.dto';
import {
  getAccountingPermissions,
  canAssignAccountingPermission,
  parseAccountingPermissions,
  ACCOUNTING_PERMISSIONS,
  ACCOUNTING_PERMISSIONS_KEY,
  ACCOUNTING_USER_ROLES,
  AccountingPermissionsClient,
  AccountingPermissionsMap,
} from '../../../utils/accounting-permissions';

@Injectable()
export class AccountingPermissionsService {
  constructor(private prisma: PrismaService) {}

  private async assertOwner(client: AccountingPermissionsClient, actorId: string) {
    const { user } = await getAccountingPermissions(client, actorId);
    if (user.role !== 'OWNER')
      throw new ForbiddenException('เฉพาะเจ้าของที่จัดการสิทธิ์รายการบัญชีได้');
  }

  private async readSettings(client: AccountingPermissionsClient) {
    const [users, config] = await Promise.all([
      client.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          isSystemUser: false,
          role: { in: ACCOUNTING_USER_ROLES },
        },
        select: { id: true, name: true, role: true },
        orderBy: [{ role: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
      client.systemConfig.findFirst({
        where: { key: ACCOUNTING_PERMISSIONS_KEY, deletedAt: null },
        select: { value: true },
      }),
    ]);
    const assignments = parseAccountingPermissions(config?.value);
    return {
      users: users.map((user) => ({
        ...user,
        permissions:
          user.role === 'OWNER'
            ? [...ACCOUNTING_PERMISSIONS]
            : Object.prototype.hasOwnProperty.call(assignments, user.id)
              ? assignments[user.id].filter((permission) => canAssignAccountingPermission(user.role, permission))
              : [],
      })),
    };
  }

  async getSettings(actorId: string) {
    await this.assertOwner(this.prisma, actorId);
    return this.readSettings(this.prisma);
  }

  getMyPermissions(actorId: string) {
    return getAccountingPermissions(this.prisma, actorId);
  }

  async updateSettings(dto: UpdateAccountingSettingsDto, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertOwner(tx, actorId);
      // Serialize full replacements so each audit captures the policy it replaced.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('accounting_permissions'))`;
      const ids = dto.users.map((user) => user.userId);
      const users = await tx.user.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          isActive: true,
          isSystemUser: false,
          role: { in: ACCOUNTING_USER_ROLES },
        },
        select: { id: true, role: true },
      });
      if (new Set(ids).size !== ids.length || users.length !== ids.length) {
        throw new BadRequestException('รายชื่อผู้ใช้ซ้ำ หรือมีผู้ใช้ที่ไม่สามารถกำหนดสิทธิ์ได้');
      }
      const before = await tx.systemConfig.findFirst({
        where: { key: ACCOUNTING_PERMISSIONS_KEY, deletedAt: null },
        select: { value: true },
      });
      const usersById = new Map(users.map((user) => [user.id, user]));
      if (dto.users.some((entry) => entry.permissions.some((permission) =>
        !canAssignAccountingPermission(usersById.get(entry.userId)!.role, permission)))) {
        throw new BadRequestException('สิทธิ์ไม่ตรงกับขอบเขตการใช้งานของผู้ใช้');
      }
      const assignments: AccountingPermissionsMap = Object.fromEntries(
        dto.users
          .filter(
            (user) => usersById.get(user.userId)?.role !== 'OWNER' && user.permissions.length > 0,
          )
          .map((user) => [
            user.userId,
            ACCOUNTING_PERMISSIONS.filter((permission) =>
              user.permissions.includes(permission),
            ),
          ]),
      );
      await tx.systemConfig.upsert({
        where: { key: ACCOUNTING_PERMISSIONS_KEY },
        update: { value: JSON.stringify(assignments), deletedAt: null },
        create: {
          key: ACCOUNTING_PERMISSIONS_KEY,
          value: JSON.stringify(assignments),
          label: 'สิทธิ์รายรับและรายจ่ายรายบุคคล',
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'ACCOUNTING_PERMISSIONS_UPDATED',
          entity: 'SystemConfig',
          entityId: ACCOUNTING_PERMISSIONS_KEY,
          oldValue: { permissions: parseAccountingPermissions(before?.value) },
          newValue: { permissions: assignments },
        },
      });
      return { settings: await this.readSettings(tx) };
    });
    return result.settings;
  }
}
