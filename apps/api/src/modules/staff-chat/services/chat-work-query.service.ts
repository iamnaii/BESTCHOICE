import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ChatWorkActor, ChatWorkItem, ChatWorkPage, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatWorkAccessService, roomWorkWhere, WORK_ROLES } from './chat-work-access.service';
import { ChatWorkQueryDto } from '../dto/chat-work-query.dto';

@Injectable()
export class ChatWorkQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
  ) {}
  async list(
    authenticated: ChatWorkActor,
    query: ChatWorkQueryDto,
    now = new Date(),
  ): Promise<ChatWorkPage> {
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await this.access.currentActor(authenticated, tx);
        const room = await this.access.roomWhere(actor, query, tx);
        const waiting: Prisma.ChatRoomWhereInput = { AND: [room, { waitingSince: { not: null } }] };
        const unassigned: Prisma.ChatRoomWhereInput = { AND: [waiting, { assignedToId: null }] };
        const localDate = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
        const start = new Date(`${localDate}T00:00:00+07:00`);
        const end = new Date(start.getTime() + 86400_000);
        const active: Prisma.TodoWhereInput = {
          deletedAt: null,
          room,
          status: { in: ['TODO', 'DOING', 'REVIEW'] },
        };
        const manager = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(actor.role);
        let orphan: Prisma.TodoWhereInput = { id: { in: [] } };
        if (manager) {
          // Build database predicates from the small staff directory, never filter/count all tasks in JS.
          const staff = await tx.user.findMany({
            where: {
              isActive: true,
              deletedAt: null,
              isSystemUser: false,
              role: { in: [...WORK_ROLES] },
            },
            select: { id: true, role: true, branchId: true, accessibleCompanies: true },
          });
          const eligible: Prisma.TodoWhereInput[] = [];
          for (const person of staff)
            try {
              eligible.push({
                assigneeId: person.id,
                room: roomWorkWhere(person, { company: query.company }),
              });
            } catch (error) {
              if (!(error instanceof ForbiddenException)) throw error;
            }
          orphan = { NOT: { OR: eligible } };
        }
        const todos = {
          TODAY: { AND: [active, { dueDate: { gte: start, lt: end } }] },
          OVERDUE: { AND: [active, { dueDate: { lt: now } }] },
          FOR_ME: { AND: [active, { OR: [{ assigneeId: actor.id }, orphan] }] },
        } satisfies Record<string, Prisma.TodoWhereInput>;
        const [WAITING, UNASSIGNED, TODAY, OVERDUE, FOR_ME] = await Promise.all([
          tx.chatRoom.count({ where: waiting }),
          tx.chatRoom.count({ where: unassigned }),
          tx.todo.count({ where: todos.TODAY }),
          tx.todo.count({ where: todos.OVERDUE }),
          tx.todo.count({ where: todos.FOR_ME }),
        ]);
        const counts = { WAITING, UNASSIGNED, TODAY, OVERDUE, FOR_ME };
        const pagination = { skip: (query.page - 1) * query.limit, take: query.limit };
        let data: ChatWorkItem[];
        if (query.view === 'WAITING' || query.view === 'UNASSIGNED') {
          const rooms = await tx.chatRoom.findMany({
            where: query.view === 'WAITING' ? waiting : unassigned,
            ...pagination,
            orderBy: [{ waitingSince: 'asc' }, { id: 'asc' }],
            select: { id: true, displayName: true, assignedToId: true, waitingSince: true },
          });
          data = rooms.map((r) => ({
            key: `ROOM_WAIT:${r.id}`,
            kind: 'ROOM_WAIT',
            roomId: r.id,
            title: r.displayName || 'ลูกค้ารอคำตอบ',
            assigneeId: r.assignedToId,
            dueAt: null,
            waitingSince: r.waitingSince?.toISOString() ?? null,
            targetType: 'ROOM',
            targetId: r.id,
          }));
        } else {
          const rows = await tx.todo.findMany({
            where: todos[query.view],
            ...pagination,
            orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
            select: {
              id: true,
              roomId: true,
              title: true,
              assigneeId: true,
              dueDate: true,
              workKind: true,
            },
          });
          const orphanIds = new Set(
            (
              await tx.todo.findMany({
                where: { AND: [orphan, { id: { in: rows.map((t) => t.id) } }] },
                select: { id: true },
              })
            ).map((t) => t.id),
          );
          data = rows.map((t) => ({
            key: `TODO:${t.id}`,
            kind: 'TODO',
            workKind: t.workKind,
            orphaned: orphanIds.has(t.id),
            roomId: t.roomId,
            title: t.title,
            assigneeId: t.assigneeId,
            dueAt: t.dueDate?.toISOString() ?? null,
            waitingSince: null,
            targetType: 'TODO',
            targetId: t.id,
          }));
        }
        return {
          data,
          counts,
          total: counts[query.view],
          page: query.page,
          limit: query.limit,
          observedAt: now.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async target(actor: ChatWorkActor, scope: WorkScope, type: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      if (type === 'ROOM') {
        const room = await this.access.assertRoom(id, actor, scope, tx);
        return {
          targetType: type,
          targetId: id,
          roomId: room.id,
          title: room.displayName || 'ห้องแชท',
        };
      }
      if (type === 'TODO') {
        const todo = await this.access.assertTodo(id, actor, scope, tx);
        return {
          targetType: type,
          targetId: id,
          roomId: todo.roomId,
          title: todo.title,
          content: todo.description,
          status: todo.status,
          workKind: todo.workKind,
          revision: todo.revision,
          dueAt: todo.dueDate,
          assigneeId: todo.assigneeId,
        };
      }
      if (type === 'NOTE') {
        const room = await this.access.roomWhere(actor, scope, tx);
        const note = await tx.chatNote.findFirst({
          where: { id, deletedAt: null, room },
          select: { content: true, roomId: true },
        });
        if (note)
          return {
            targetType: type,
            targetId: id,
            roomId: note.roomId,
            title: 'โน้ตภายใน',
            content: note.content,
          };
      }
      throw new NotFoundException('ไม่พบรายการหรือไม่มีสิทธิ์เข้าถึง');
    });
  }
}
