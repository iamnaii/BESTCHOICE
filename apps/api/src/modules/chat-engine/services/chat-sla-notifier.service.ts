import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  Inject,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { StaffInboxInput, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ChatWorkAccessService,
  WORK_ROLES,
} from '../../staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../../staff-chat/services/staff-inbox.service';
import { ResponseCycleService } from './response-cycle.service';
import {
  businessMinutesBetween,
  businessWindows,
  policyFromVersion,
  readAlertGate,
} from './chat-sla-policy';
import { CHAT_GATEWAY_TOKEN, IChatGateway } from '../interfaces/chat-gateway.interface';

@Injectable()
export class ChatSlaNotifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
    private readonly inbox: StaffInboxService,
    private readonly cycles: ResponseCycleService,
    @Optional() @Inject(CHAT_GATEWAY_TOKEN) private readonly gateway?: IChatGateway,
  ) {}

  private async recipients(
    tx: Prisma.TransactionClient,
    roomId: string,
    scope: WorkScope,
    assignedToId: string | null,
  ) {
    const users = await tx.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        isSystemUser: false,
        role: { in: [...WORK_ROLES] },
      },
    });
    const eligible: User[] = [];
    for (const user of users) {
      try {
        await this.access.assertRoom(roomId, user, scope, tx);
        eligible.push(user);
      } catch (error) {
        if (!(error instanceof ForbiddenException) && !(error instanceof NotFoundException))
          throw error;
      }
    }
    const assigned = users.find((user) => user.id === assignedToId);
    const managers = assigned?.branchId
      ? eligible.filter(
          (user) =>
            (user.role === 'BRANCH_MANAGER' || user.role === 'FINANCE_MANAGER') &&
            (user.role === 'FINANCE_MANAGER' || user.branchId === assigned.branchId),
        )
      : [];
    const fallback = managers.length ? managers : eligible.filter((user) => user.role === 'OWNER');
    return { eligible, fallback };
  }
  private async enqueue(tx: Prisma.TransactionClient, input: StaffInboxInput) {
    if (
      await tx.staffInboxItem.findUnique({
        where: { dedupeKey: input.dedupeKey },
        select: { id: true },
      })
    )
      return null;
    const created = await this.inbox.enqueue(tx, input);
    return created ? input.recipientId : null;
  }
  private hint(recipientIds: string[]) {
    for (const id of new Set(recipientIds))
      this.gateway?.emitToStaff(id, 'chat:work:update', { refresh: true });
  }
  async scan(now: Date): Promise<{ created: number; skipped: number }> {
    const initial = await readAlertGate(this.prisma);
    if (!initial.enabled) return { created: 0, skipped: 0 };
    let created = 0;
    let skipped = 0;
    let cursor: string | undefined;
    for (;;) {
      const candidates = await this.prisma.chatResponseCycle.findMany({
        where: {
          endedAt: null,
          deletedAt: null,
          alertEligibleAt: { gte: initial.cutover, lte: now },
          room: { deletedAt: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 200,
        select: { id: true, roomId: true },
      });
      if (!candidates.length) break;
      for (const candidate of candidates) {
        const recipients = await this.prisma
          .$transaction(async (tx) => {
            await this.cycles.lock(tx, candidate.roomId);
            const gate = await readAlertGate(tx, true);
            if (!gate.enabled) return [];
            const cycle = await tx.chatResponseCycle.findFirst({
              where: {
                id: candidate.id,
                endedAt: null,
                deletedAt: null,
                alertEligibleAt: { gte: gate.cutover, lte: now },
              },
              include: { room: true },
            });
            if (
              !cycle ||
              !cycle.room.waitingSince ||
              cycle.room.deletedAt ||
              !cycle.alertEligibleAt
            )
              return [];
            const company = cycle.room.channel === 'LINE_FINANCE' ? 'FINANCE' : 'SHOP';
            const policy = policyFromVersion(cycle.policyVersion);
            const elapsed = businessMinutesBetween(
              cycle.alertEligibleAt,
              now,
              businessWindows(cycle.alertEligibleAt, now, company, policy),
            );
            const { eligible, fallback } = await this.recipients(
              tx,
              cycle.roomId,
              { company },
              cycle.room.assignedToId,
            );
            const owner = eligible.find((user) => user.id === cycle.room.assignedToId);
            const targets = [
              ...(elapsed >= policy.ownerMinutes
                ? (owner ? [owner] : fallback).map((user) => ({ id: user.id, level: 'owner' }))
                : []),
              ...(elapsed >= policy.managerMinutes
                ? fallback.map((user) => ({ id: user.id, level: 'manager' }))
                : []),
            ];
            const notified: string[] = [];
            for (const target of targets) {
              const recipient = await this.enqueue(tx, {
                recipientId: target.id,
                kind: 'CHAT_SLA',
                roomId: cycle.roomId,
                dedupeKey: `sla:${cycle.id}:${target.level}:${target.id}`,
                title:
                  target.level === 'owner'
                    ? 'มีแชทรอคำตอบจากพนักงาน'
                    : 'มีแชทรอเกินเวลาเตือนหัวหน้า',
                targetType: 'ROOM',
                targetId: cycle.roomId,
              });
              if (recipient) notified.push(recipient);
            }
            return notified;
          })
          .catch((error) => {
            if (error instanceof NotFoundException) return [];
            throw error;
          });
        created += recipients.length;
        if (!recipients.length) skipped++;
        this.hint(recipients);
      }
      cursor = candidates[candidates.length - 1].id;
    }
    cursor = undefined;
    for (;;) {
      const candidates = await this.prisma.todo.findMany({
        where: {
          deletedAt: null,
          roomId: { not: null },
          room: { deletedAt: null },
          status: { in: ['TODO', 'DOING', 'REVIEW'] },
          dueDate: { lte: now },
          OR: [{ dueDate: { gte: initial.cutover } }, { updatedAt: { gte: initial.cutover } }],
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 200,
        select: { id: true, roomId: true },
      });
      if (!candidates.length) break;
      for (const candidate of candidates) {
        const recipients = await this.prisma
          .$transaction(async (tx) => {
            await this.cycles.lock(tx, candidate.roomId!);
            await tx.$queryRaw`SELECT id FROM todos WHERE id = ${candidate.id} FOR UPDATE`;
            const gate = await readAlertGate(tx, true);
            if (!gate.enabled) return [];
            const todo = await tx.todo.findFirst({
              where: {
                id: candidate.id,
                roomId: candidate.roomId,
                deletedAt: null,
                status: { in: ['TODO', 'DOING', 'REVIEW'] },
                dueDate: { lte: now },
                OR: [{ dueDate: { gte: gate.cutover } }, { updatedAt: { gte: gate.cutover } }],
              },
              include: { room: true },
            });
            if (!todo?.room || todo.room.deletedAt || !todo.dueDate) return [];
            const company = todo.room.channel === 'LINE_FINANCE' ? 'FINANCE' : 'SHOP';
            const { eligible, fallback } = await this.recipients(
              tx,
              todo.room.id,
              { company },
              todo.room.assignedToId,
            );
            const assignee = eligible.find((user) => user.id === todo.assigneeId);
            const notified: string[] = [];
            for (const target of assignee ? [assignee] : fallback) {
              const recipient = await this.enqueue(tx, {
                recipientId: target.id,
                kind: 'FOLLOW_UP',
                roomId: todo.room.id,
                todoId: todo.id,
                dedupeKey: `todo:${todo.id}:${todo.dueDate.toISOString()}:${target.id}`,
                title: 'มีงานติดตามถึงกำหนด',
                targetType: 'TODO',
                targetId: todo.id,
              });
              if (recipient) notified.push(recipient);
            }
            return notified;
          })
          .catch((error) => {
            if (error instanceof NotFoundException) return [];
            throw error;
          });
        created += recipients.length;
        if (!recipients.length) skipped++;
        this.hint(recipients);
      }
      cursor = candidates[candidates.length - 1].id;
    }
    return { created, skipped };
  }
}
