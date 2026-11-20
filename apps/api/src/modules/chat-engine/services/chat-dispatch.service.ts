import { ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { ChatDispatchState, ChatWorkActor, WorkScope } from '@installment/shared';
import { canAccess } from '@installment/shared';
import { AccessSnapshotService } from '../../employee-access/access-snapshot.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ChatWorkAccessService,
  roomWorkWhere,
  WORK_CHANNELS,
} from '../../staff-chat/services/chat-work-access.service';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { CHAT_GATEWAY_TOKEN, IChatGateway } from '../interfaces/chat-gateway.interface';

export const DISPATCH_LEASE_MS = 90_000;
export async function lockChatDispatch(db: Prisma.TransactionClient) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('chat-round-robin'))`;
}

@Injectable()
export class ChatDispatchService {
  private readonly logger = new Logger(ChatDispatchService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
    @Optional() @Inject(CHAT_GATEWAY_TOKEN) private readonly gateway?: IChatGateway,
  ) {}

  async enabled(db: Prisma.TransactionClient = this.prisma) {
    return (
      (await db.systemConfig.count({
        where: {
          key: { in: ['chat_round_robin_enabled', 'chat_work_queue_enabled'] },
          value: 'true',
          deletedAt: null,
        },
      })) === 2
    );
  }

  private async nextPosition(db: Prisma.TransactionClient, company: WorkScope['company']) {
    const max = await db.chatDispatchMember.aggregate({
      where: { company },
      _max: { position: true },
    });
    return (max._max.position ?? 0n) + 1n;
  }

  private async members(db: Prisma.TransactionClient, company: WorkScope['company'], now: Date) {
    const rows = await db.chatDispatchMember.findMany({
      where: {
        company,
        deletedAt: null,
        readyUntil: { gt: now },
        staff: { isActive: true, isSystemUser: false, deletedAt: null },
      },
      include: {
        staff: { select: { id: true, role: true, branchId: true, accessibleCompanies: true } },
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const eligible = await Promise.all(rows.map(async (row) => {
      try {
        roomWorkWhere(row.staff, { company });
        return await this.canReceiveUnassigned(db, row.staffId, company);
      } catch (error) {
        if (error instanceof ForbiddenException) return false;
        throw error;
      }
    }));
    return rows.filter((_, index) => eligible[index]);
  }

  private async canReceiveUnassigned(db: Prisma.TransactionClient, staffId: string, company: WorkScope['company']) {
    const snapshot = await new AccessSnapshotService(this.prisma).forUserInTransaction(db, staffId);
    if (!snapshot.managed || snapshot.isOwner) return true;
    // Chat source authority is company + existing assignee, not the customer's
    // branch. All dispatch candidates are unassigned: ASSIGNED cannot authorize
    // creating one's own ownership, and BRANCHES cannot invent a source branch.
    const resource = { company, assignedUserIds: [] };
    return canAccess(snapshot, 'chat.read', resource) && canAccess(snapshot, 'chat.update', resource);
  }

  async read(actor: Pick<ChatWorkActor, 'id'>, scope: WorkScope): Promise<ChatDispatchState> {
    roomWorkWhere(await this.access.currentActor(actor), scope);
    const enabled = await this.enabled();
    const rows = enabled ? await this.members(this.prisma, scope.company, new Date()) : [];
    const index = rows.findIndex((row) => row.staffId === actor.id);
    const member = rows[index];
    return {
      enabled,
      ready: !!member,
      generation: member?.generation ?? null,
      expiresAt: member?.readyUntil?.toISOString() ?? null,
      position: member ? index + 1 : null,
      readyCount: rows.length,
    };
  }

  async setReady(actor: Pick<ChatWorkActor, 'id'>, scope: WorkScope, ready: boolean) {
    await this.prisma.$transaction(async (db) => {
      await lockChatDispatch(db);
      roomWorkWhere(await this.access.currentActor(actor, db), scope);
      if (ready && !(await this.canReceiveUnassigned(db, actor.id, scope.company)))
        throw new ForbiddenException('ไม่มีสิทธิ์รับแชทที่ยังไม่มีผู้ดูแลในบริษัทนี้');
      if (ready && !(await this.enabled(db)))
        throw new ForbiddenException('เจ้าของยังไม่ได้เปิดแจกแชทตามคิว');
      const now = new Date();
      const existing = await db.chatDispatchMember.findUnique({
        where: { staffId_company: { staffId: actor.id, company: scope.company } },
      });
      const stillReady =
        existing && !existing.deletedAt && existing.readyUntil && existing.readyUntil > now;
      const data = {
        readyUntil: ready ? new Date(now.getTime() + DISPATCH_LEASE_MS) : null,
        generation: ready && stillReady ? existing.generation : randomUUID(),
        position:
          ready && !stillReady
            ? await this.nextPosition(db, scope.company)
            : (existing?.position ?? 0n),
        deletedAt: null,
      };
      await db.chatDispatchMember.upsert({
        where: { staffId_company: { staffId: actor.id, company: scope.company } },
        create: { staffId: actor.id, company: scope.company, ...data },
        update: data,
      });
      if (!!stillReady !== ready)
        await db.staffChatActivity.create({
          data: {
            staffId: actor.id,
            action: ready ? 'dispatch_ready' : 'dispatch_paused',
            metadata: { company: scope.company },
          },
        });
    });
    if (ready) await this.drain(scope.company);
    return this.read(actor, scope);
  }

  async heartbeat(actor: Pick<ChatWorkActor, 'id'>, scope: WorkScope, generation: string) {
    const renewed = await this.prisma.$transaction(async (db) => {
      await lockChatDispatch(db);
      roomWorkWhere(await this.access.currentActor(actor, db), scope);
      if (!(await this.canReceiveUnassigned(db, actor.id, scope.company)))
        throw new ForbiddenException('ไม่มีสิทธิ์รับแชทที่ยังไม่มีผู้ดูแลในบริษัทนี้');
      if (!(await this.enabled(db))) return false;
      const now = new Date();
      const result = await db.chatDispatchMember.updateMany({
        where: {
          staffId: actor.id,
          company: scope.company,
          generation,
          readyUntil: { gt: now },
          deletedAt: null,
        },
        data: { readyUntil: new Date(now.getTime() + DISPATCH_LEASE_MS) },
      });
      return result.count === 1;
    });
    if (renewed) await this.drain(scope.company);
    return this.read(actor, scope);
  }

  /** Called inside the inbound-message transaction. Never scans historic rooms on activation. */
  async enqueueInTx(db: Prisma.TransactionClient, roomId: string, receivedAt: Date) {
    await db.chatRoom.updateMany({
      where: {
        id: roomId,
        assignedToId: null,
        deletedAt: null,
        // A closed/answered unassigned room may still have an old marker. A new
        // waiting cycle joins at its new arrival time, not at the previous turn.
        OR: [
          { dispatchQueuedAt: null },
          { waitingSince: receivedAt, dispatchQueuedAt: { lt: receivedAt } },
        ],
      },
      data: { dispatchQueuedAt: receivedAt },
    });
  }

  async drain(company: WorkScope['company']) {
    const assigned = await this.prisma.$transaction(
      async (db) => {
        await lockChatDispatch(db);
        if (!(await this.enabled(db))) return [];
        const now = new Date();
        let members = await this.members(db, company, now);
        if (!members.length) return [];
        // Keep grants stable until commit, even when another instance revokes an employee.
        await db.$queryRaw`SELECT id FROM users WHERE id IN (${Prisma.join(members.map((m) => m.staffId))}) ORDER BY id FOR SHARE`;
        members = await this.members(db, company, new Date());
        const branchWhere: Prisma.ChatRoomWhereInput = members.some((member) =>
          hasCrossBranchAccess(member.staff),
        )
          ? {}
          : {
              OR: [
                { customerId: null },
                { customer: { accessBranchId: null } },
                {
                  customer: {
                    accessBranchId: {
                      in: members.flatMap((member) =>
                        member.staff.branchId ? [member.staff.branchId] : [],
                      ),
                    },
                  },
                },
              ],
            };
        const rooms = await db.chatRoom.findMany({
          where: {
            ...branchWhere,
            deletedAt: null,
            assignedToId: null,
            dispatchQueuedAt: { not: null },
            waitingSince: { not: null },
            resolvedAt: null,
            channel: { in: WORK_CHANNELS[company] },
          },
          select: { id: true, customer: { select: { accessBranchId: true } } },
          orderBy: [{ dispatchQueuedAt: 'asc' }, { id: 'asc' }],
          take: 100,
        });
        let next = await this.nextPosition(db, company);
        const results: { roomId: string; staffId: string }[] = [];
        for (const room of rooms) {
          const candidate = members.find(
            (member) =>
              member.readyUntil &&
              member.readyUntil > new Date() &&
              (!room.customer?.accessBranchId ||
                hasCrossBranchAccess(member.staff) ||
                member.staff.branchId === room.customer.accessBranchId),
          );
          if (!candidate) continue;
          const candidateBranch: Prisma.ChatRoomWhereInput = hasCrossBranchAccess(candidate.staff)
            ? {}
            : {
                OR: [
                  { customerId: null },
                  { customer: { accessBranchId: null } },
                  { customer: { accessBranchId: candidate.staff.branchId } },
                ],
              };
          const result = await db.chatRoom.updateMany({
            where: {
              AND: [
                {
                  id: room.id,
                  assignedToId: null,
                  dispatchQueuedAt: { not: null },
                  waitingSince: { not: null },
                  resolvedAt: null,
                },
                roomWorkWhere(candidate.staff, { company }),
                candidateBranch,
              ],
            },
            data: { assignedToId: candidate.staffId, dispatchQueuedAt: null, status: 'ACTIVE' },
          });
          if (!result.count) continue; // Manual assignment won; do not consume a turn.
          await db.chatDispatchMember.update({
            where: { id: candidate.id },
            data: { position: next++ },
          });
          await db.staffChatActivity.create({
            data: {
              staffId: candidate.staffId,
              action: 'assign',
              metadata: { roomId: room.id, source: 'round_robin', company },
            },
          });
          results.push({ roomId: room.id, staffId: candidate.staffId });
          members = [...members.filter((m) => m.id !== candidate.id), candidate];
        }
        return results;
      },
      { timeout: 15_000, maxWait: 15_000 },
    );
    for (const item of assigned) {
      this.gateway?.emitRoomUpdate(item.roomId, {
        event: 'assigned',
        roomId: item.roomId,
        assignedToId: item.staffId,
      });
      this.gateway?.emitToStaff(item.staffId, 'chat:assigned', {
        roomId: item.roomId,
        assignedToId: item.staffId,
      });
    }
    return assigned;
  }

  /** Employees cannot bypass rotation by replying to an unassigned room first. */
  async assertMayReply(roomId: string, staffId: string) {
    if (!(await this.enabled())) return;
    const { actor, room } = await this.access.roomContext(roomId, { id: staffId });
    if (actor.role === 'SALES' && room.assignedToId !== actor.id)
      throw new ForbiddenException('ห้องนี้ยังไม่ได้มอบหมายให้คุณ กรุณารับงานผ่านคิวแชท');
  }

  @Cron('*/15 * * * * *', { timeZone: 'Asia/Bangkok' })
  async recoverPending() {
    for (const company of ['SHOP', 'FINANCE'] as const) {
      try {
        await this.drain(company);
      } catch (error) {
        this.logger.error(`Chat dispatch recovery failed: ${company}`, error);
      }
    }
  }
}
