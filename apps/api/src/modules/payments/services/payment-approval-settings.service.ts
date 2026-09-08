import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdatePaymentApprovalSettingsDto } from '../dto/update-payment-approval-settings.dto';
import {
  getPaymentApprovalPermissions,
  parsePaymentApprovalPermissions,
  PAYMENT_APPROVAL_PERMISSIONS,
  PAYMENT_APPROVAL_PERMISSIONS_KEY,
  PAYMENT_APPROVAL_USER_ROLES,
  PaymentApprovalPermissionsClient,
  PaymentApprovalPermissionsMap,
} from './payment-approval-permissions';

@Injectable()
export class PaymentApprovalSettingsService {
  constructor(private prisma: PrismaService) {}

  private async assertOwner(client: PaymentApprovalPermissionsClient, actorId: string) {
    const { user } = await getPaymentApprovalPermissions(client, actorId);
    if (user.role !== 'OWNER')
      throw new ForbiddenException('เฉพาะเจ้าของที่จัดการสิทธิ์อนุมัติรับชำระได้');
  }

  private async readSettings(client: PaymentApprovalPermissionsClient) {
    const [users, config] = await Promise.all([
      client.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          isSystemUser: false,
          role: { in: PAYMENT_APPROVAL_USER_ROLES },
        },
        select: { id: true, name: true, role: true },
        orderBy: [{ role: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
      client.systemConfig.findFirst({
        where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY, deletedAt: null },
        select: { value: true },
      }),
    ]);
    const assignments = parsePaymentApprovalPermissions(config?.value);
    return {
      users: users.map((user) => ({
        ...user,
        permissions:
          user.role === 'OWNER'
            ? [...PAYMENT_APPROVAL_PERMISSIONS]
            : Object.prototype.hasOwnProperty.call(assignments, user.id)
              ? assignments[user.id]
              : [],
      })),
    };
  }

  async getSettings(actorId: string) {
    await this.assertOwner(this.prisma, actorId);
    return this.readSettings(this.prisma);
  }

  getMyPermissions(actorId: string) {
    return getPaymentApprovalPermissions(this.prisma, actorId);
  }

  async updateSettings(dto: UpdatePaymentApprovalSettingsDto, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertOwner(tx, actorId);
      // Serialize full replacements so each audit captures the policy it replaced.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payment_approval_permissions'))`;
      const ids = dto.users.map((user) => user.userId);
      const users = await tx.user.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          isActive: true,
          isSystemUser: false,
          role: { in: PAYMENT_APPROVAL_USER_ROLES },
        },
        select: { id: true, role: true },
      });
      if (new Set(ids).size !== ids.length || users.length !== ids.length) {
        throw new BadRequestException('รายชื่อผู้ใช้ซ้ำ หรือมีผู้ใช้ที่ไม่สามารถกำหนดสิทธิ์ได้');
      }
      const before = await tx.systemConfig.findFirst({
        where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY, deletedAt: null },
        select: { value: true },
      });
      const usersById = new Map(users.map((user) => [user.id, user]));
      const assignments: PaymentApprovalPermissionsMap = Object.fromEntries(
        dto.users
          .filter(
            (user) => usersById.get(user.userId)?.role !== 'OWNER' && user.permissions.length > 0,
          )
          .map((user) => [
            user.userId,
            PAYMENT_APPROVAL_PERMISSIONS.filter((permission) =>
              user.permissions.includes(permission),
            ),
          ]),
      );
      await tx.systemConfig.upsert({
        where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY },
        update: { value: JSON.stringify(assignments), deletedAt: null },
        create: {
          key: PAYMENT_APPROVAL_PERMISSIONS_KEY,
          value: JSON.stringify(assignments),
          label: 'สิทธิ์อนุมัติรายการรับชำระรายบุคคล',
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'PAYMENT_APPROVAL_PERMISSIONS_UPDATED',
          entity: 'SystemConfig',
          entityId: PAYMENT_APPROVAL_PERMISSIONS_KEY,
          oldValue: { permissions: parsePaymentApprovalPermissions(before?.value) },
          newValue: { permissions: assignments },
        },
      });
      return { settings: await this.readSettings(tx) };
    });
    return result.settings;
  }
}
