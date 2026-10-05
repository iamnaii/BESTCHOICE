import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatChannel, Prisma } from '@prisma/client';
import { ChatWorkActor, WorkScope, hasCompanyAccess } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { getBranchScope } from '../../auth/branch-access.util';

export const WORK_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'] as const;
export const WORK_CHANNELS: Record<WorkScope['company'], ChatChannel[]> = {
  SHOP: ['LINE_SHOP', 'FACEBOOK', 'TIKTOK', 'WEB'],
  FINANCE: ['LINE_FINANCE'],
};
/** Shared database predicate: counts and rows cannot diverge from deep-link access. */
export function roomWorkWhere(actor: ChatWorkActor, scope: WorkScope): Prisma.ChatRoomWhereInput {
  if (
    !WORK_ROLES.some((role) => role === actor.role) ||
    !hasCompanyAccess(actor.role, actor.accessibleCompanies, scope.company)
  ) {
    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงงานของบริษัทนี้');
  }
  const branch = getBranchScope(actor);
  if (!branch.all && (!branch.branchId || (scope.branchId && scope.branchId !== branch.branchId))) {
    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงงานของสาขานี้');
  }
  const branchId = branch.all ? scope.branchId : branch.branchId;
  const AND: Prisma.ChatRoomWhereInput[] = [];
  // The original room reader restricts SALES to their own or still unassigned rooms.
  if (actor.role === 'SALES')
    AND.push({ OR: [{ assignedToId: null }, { assignedToId: actor.id }] });
  if (branchId) AND.push({ OR: [{ assignedToId: null }, { assignedTo: { branchId } }] });
  return { deletedAt: null, channel: { in: WORK_CHANNELS[scope.company] }, AND };
}

@Injectable()
export class ChatWorkAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async currentActor(
    actor: Pick<ChatWorkActor, 'id'>,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<ChatWorkActor> {
    const current = await db.user.findFirst({
      where: { id: actor.id, deletedAt: null, isActive: true, isSystemUser: false },
      select: { id: true, role: true, branchId: true, accessibleCompanies: true },
    });
    if (!current) throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์ใช้งาน');
    return current;
  }
  async roomWhere(
    actor: ChatWorkActor,
    scope: WorkScope,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    return roomWorkWhere(await this.currentActor(actor, db), scope);
  }
  async assertRoom(
    roomId: string,
    actor: ChatWorkActor,
    scope: WorkScope,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const where = await this.roomWhere(actor, scope, db);
    const room = await db.chatRoom.findFirst({ where: { AND: [where, { id: roomId }] } });
    if (!room) throw new NotFoundException('ไม่พบห้องแชทหรือไม่มีสิทธิ์เข้าถึง');
    return room;
  }
  async assertTodo(
    todoId: string,
    actor: ChatWorkActor,
    scope: WorkScope,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const where = await this.roomWhere(actor, scope, db);
    const todo = await db.todo.findFirst({ where: { id: todoId, deletedAt: null, room: where } });
    if (!todo) throw new NotFoundException('ไม่พบงานหรือไม่มีสิทธิ์เข้าถึง');
    return todo;
  }
  async eligibleStaff(
    roomId: string,
    actor: ChatWorkActor,
    scope: WorkScope,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    await this.assertRoom(roomId, actor, scope, db);
    const staff = await db.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        isSystemUser: false,
        role: { in: [...WORK_ROLES] },
      },
      select: { id: true, name: true, role: true, branchId: true, accessibleCompanies: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const eligible: typeof staff = [];
    for (const user of staff) {
      try {
        if (
          await db.chatRoom.count({ where: { AND: [roomWorkWhere(user, scope), { id: roomId }] } })
        )
          eligible.push(user);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return eligible.map(({ id, name, role }) => ({ id, name, role }));
  }
}
