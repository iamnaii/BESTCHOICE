import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCESS_BOUNDARIES } from './access-policy.registry';

export const CHAT_DISPATCH_ROUTES = ['read', 'ready', 'heartbeat'].map(
  (method) => `ChatDispatchController.${method}`,
);

/** Readiness belongs to the authenticated staff member, never a caller-selected user/branch.
 * This authorizes their own readiness only. Dispatch separately checks permission
 * to acquire an unassigned room, including after a live lease's grants change.
 */
@Injectable()
export class AccessChatDispatchBoundary implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    for (const route of CHAT_DISPATCH_ROUTES) {
      ACCESS_BOUNDARIES.set(route, async (req, snapshot) => {
        const company = typeof req.query?.company === 'string' ? req.query.company.toUpperCase() : undefined;
        if (company !== 'SHOP' && company !== 'FINANCE') throw new BadRequestException('กรุณาเลือกบริษัท');
        const staff = await this.prisma.user.findFirst({
          where: { id: snapshot.userId, isActive: true, isSystemUser: false, deletedAt: null },
          select: { branchId: true },
        });
        if (!staff) throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์ใช้งาน');
        return { kind: 'resource', resource: { company, branchId: staff.branchId, assignedUserIds: [snapshot.userId] } };
      });
    }
  }
}
