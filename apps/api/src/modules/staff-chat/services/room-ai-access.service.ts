import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { getBranchScope } from '../../auth/branch-access.util';

export interface StaffAiActor {
  id: string;
  role: string;
  branchId: string | null;
  accessibleCompanies?: string[];
}

const CHANNEL_COMPANY: Record<ChatChannel, 'SHOP' | 'FINANCE'> = {
  LINE_FINANCE: 'FINANCE',
  LINE_SHOP: 'SHOP',
  FACEBOOK: 'SHOP',
  TIKTOK: 'SHOP',
  WEB: 'SHOP',
};

/** Check access before reading messages, calling a model, or returning cached AI text. */
@Injectable()
export class RoomAiAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAccess(roomId: string, actor: StaffAiActor) {
    if (!['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'].includes(actor.role)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ใช้ผู้ช่วยในห้องแชท');
    }
    const scope = getBranchScope(actor);
    if (!scope.all && !scope.branchId) throw new ForbiddenException('กรุณากำหนดสาขาของพนักงานก่อน');
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
      select: {
        id: true, channel: true, customerId: true, assignedToId: true,
        assignedTo: { select: { branchId: true } },
        customer: { select: { id: true, deletedAt: true } },
      },
    });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');
    const company = CHANNEL_COMPANY[room.channel];
    if (!company || !actor.accessibleCompanies?.includes(company)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทของบริษัทนี้');
    }
    if (actor.role === 'SALES' && room.assignedToId && room.assignedToId !== actor.id) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
    }
    if (!scope.all && room.assignedTo?.branchId && room.assignedTo.branchId !== scope.branchId) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องของพนักงานต่างสาขา');
    }
    return { ...room, customerId: room.customer?.deletedAt ? null : room.customerId };
  }
}
