import { syncClosedServiceWork } from './chat-service-case-state';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ChatWorkActor, ChatWorkItem, ChatWorkPage, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatWorkAccessService, roomWorkWhere, WORK_ROLES } from './chat-work-access.service';
import { parseBooleanFlag } from '../../../utils/config.util';
import { commentWorkWhere } from './facebook-comment-scope';
import { roomWorkSql, commentWorkSql } from './chat-work-sql';
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
    await syncClosedServiceWork(this.prisma, await this.access.roomWhere(authenticated, query));
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
        let commentOrphan: Prisma.FacebookCommentThreadWhereInput = { id: { in: [] } };
        let orphanSql = Prisma.sql`FALSE`;
        let commentOrphanSql = Prisma.sql`FALSE`;
        const commentsEnabled = parseBooleanFlag(
          (
            await tx.systemConfig.findFirst({
              where: { key: 'chat_facebook_comments_enabled', deletedAt: null },
            })
          )?.value,
          false,
        );
        const commentScope = commentWorkWhere(actor, query);
        const commentActive: Prisma.FacebookCommentThreadWhereInput = {
          AND: [commentScope, { status: 'OPEN', rootDeleted: false, waitingSince: { not: null } }],
        };
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
          const commentEligible: Prisma.FacebookCommentThreadWhereInput[] = [];
          const eligibleSql: Prisma.Sql[] = [];
          const commentEligibleSql: Prisma.Sql[] = [];
          for (const person of staff)
            try {
              eligible.push({
                assigneeId: person.id,
                room: roomWorkWhere(person, { company: query.company }),
              });
              commentEligible.push({
                assigneeId: person.id,
                AND: [commentWorkWhere(person, { company: query.company })],
              });
              eligibleSql.push(
                Prisma.sql`(t.assignee_id = ${person.id} AND ${roomWorkSql(person, { company: query.company })})`,
              );
              commentEligibleSql.push(
                Prisma.sql`(c.assignee_id = ${person.id} AND ${commentWorkSql(person, { company: query.company })})`,
              );
            } catch (error) {
              if (!(error instanceof ForbiddenException)) throw error;
            }
          orphan = { OR: [{ assigneeId: null }, { NOT: { OR: eligible } }] };
          commentOrphan = { OR: [{ assigneeId: null }, { NOT: { OR: commentEligible } }] };
          orphanSql = eligibleSql.length
            ? Prisma.sql`NOT COALESCE((${Prisma.join(eligibleSql, ' OR ')}), FALSE)`
            : Prisma.sql`TRUE`;
          commentOrphanSql = commentEligibleSql.length
            ? Prisma.sql`NOT COALESCE((${Prisma.join(commentEligibleSql, ' OR ')}), FALSE)`
            : Prisma.sql`TRUE`;
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
        const commentPredicates = {
          WAITING: commentActive,
          UNASSIGNED: { AND: [commentActive, { assigneeId: null }] },
          FOR_ME: { AND: [commentActive, { OR: [{ assigneeId: actor.id }, commentOrphan] }] },
        } satisfies Record<string, Prisma.FacebookCommentThreadWhereInput>;
        const commentCounts = commentsEnabled
          ? await Promise.all([
              tx.facebookCommentThread.count({ where: commentPredicates.WAITING }),
              tx.facebookCommentThread.count({ where: commentPredicates.UNASSIGNED }),
              tx.facebookCommentThread.count({ where: commentPredicates.FOR_ME }),
            ])
          : [0, 0, 0];
        const counts = {
          WAITING: WAITING + commentCounts[0],
          UNASSIGNED: UNASSIGNED + commentCounts[1],
          TODAY,
          OVERDUE,
          FOR_ME: FOR_ME + commentCounts[2],
        };
        const roomSql = roomWorkSql(actor, query);
        const source =
          query.view === 'WAITING' || query.view === 'UNASSIGNED'
            ? Prisma.sql`SELECT r.id, 'ROOM_WAIT' AS kind, r.waiting_since AS sort_at FROM chat_rooms r LEFT JOIN users room_owner ON room_owner.id = r.assigned_to_id WHERE ${roomSql} AND r.waiting_since IS NOT NULL AND ${query.view === 'UNASSIGNED' ? Prisma.sql`r.assigned_to_id IS NULL` : Prisma.sql`TRUE`}`
            : Prisma.sql`SELECT t.id, 'TODO' AS kind, t.due_date AS sort_at FROM todos t JOIN chat_rooms r ON r.id = t.room_id LEFT JOIN users room_owner ON room_owner.id = r.assigned_to_id WHERE ${roomSql} AND t.deleted_at IS NULL AND t.status IN ('TODO', 'DOING', 'REVIEW') AND ${query.view === 'TODAY' ? Prisma.sql`t.due_date >= ${start.toISOString()}::timestamp AND t.due_date < ${end.toISOString()}::timestamp` : query.view === 'OVERDUE' ? Prisma.sql`t.due_date < ${now.toISOString()}::timestamp` : Prisma.sql`(t.assignee_id = ${actor.id} OR ${orphanSql})`}`;
        const commentSource =
          commentsEnabled && ['WAITING', 'UNASSIGNED', 'FOR_ME'].includes(query.view)
            ? Prisma.sql`UNION ALL SELECT c.id, 'FACEBOOK_COMMENT' AS kind, c.waiting_since AS sort_at FROM facebook_comment_threads c WHERE ${commentWorkSql(actor, query)} AND c.status = 'OPEN' AND NOT c.root_deleted AND c.waiting_since IS NOT NULL AND ${query.view === 'UNASSIGNED' ? Prisma.sql`c.assignee_id IS NULL` : query.view === 'FOR_ME' ? Prisma.sql`(c.assignee_id = ${actor.id} OR ${commentOrphanSql})` : Prisma.sql`TRUE`}`
            : Prisma.empty;
        const selected = await tx.$queryRaw<{ id: string; kind: string }[]>(
          Prisma.sql`SELECT id, kind FROM (${source} ${commentSource}) work ORDER BY sort_at ASC NULLS LAST, kind ASC, id ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
        );
        const selectedIds = (kind: string) =>
          selected.filter((row) => row.kind === kind).map((row) => row.id);
        let data: ChatWorkItem[];
        if (query.view === 'WAITING' || query.view === 'UNASSIGNED') {
          const rooms = await tx.chatRoom.findMany({
            where: {
              AND: [
                query.view === 'WAITING' ? waiting : unassigned,
                { id: { in: selectedIds('ROOM_WAIT') } },
              ],
            },
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
            where: { AND: [todos[query.view], { id: { in: selectedIds('TODO') } }] },
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
        const comments = await tx.facebookCommentThread.findMany({
          where: { AND: [commentScope, { id: { in: selectedIds('FACEBOOK_COMMENT') } }] },
          select: {
            id: true,
            assigneeId: true,
            waitingSince: true,
            rootCommentId: true,
            records: {
              take: 1,
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: { authorName: true },
            },
          },
        });
        const orphanComments = new Set(
          (
            await tx.facebookCommentThread.findMany({
              where: { AND: [commentOrphan, { id: { in: comments.map((c) => c.id) } }] },
              select: { id: true },
            })
          ).map((c) => c.id),
        );
        data.push(
          ...comments.map((c) => ({
            key: `FACEBOOK_COMMENT:${c.id}`,
            kind: 'FACEBOOK_COMMENT' as const,
            targetType: 'FACEBOOK_COMMENT' as const,
            targetId: c.id,
            roomId: null,
            title: c.records[0]?.authorName
              ? `คอมเมนต์ · ${c.records[0].authorName}`
              : 'คอมเมนต์สาธารณะ',
            assigneeId: c.assigneeId,
            orphaned: orphanComments.has(c.id),
            waitingSince: c.waitingSince?.toISOString() ?? null,
            dueAt: null,
          })),
        );
        const byKey = new Map(data.map((item) => [item.key, item]));
        data = selected.map((row) => byKey.get(`${row.kind}:${row.id}`)!).filter(Boolean);
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
      if (type === 'FACEBOOK_COMMENT') {
        const current = await this.access.currentActor(actor, tx);
        const enabled = parseBooleanFlag(
          (
            await tx.systemConfig.findFirst({
              where: { key: 'chat_facebook_comments_enabled', deletedAt: null },
            })
          )?.value,
          false,
        );
        const thread = enabled
          ? await tx.facebookCommentThread.findFirst({
              where: { AND: [commentWorkWhere(current, scope), { id }] },
            })
          : null;
        if (!thread) throw new NotFoundException('ไม่พบคอมเมนต์หรือไม่มีสิทธิ์');
        return {
          targetType: type,
          targetId: id,
          roomId: null,
          title: 'คอมเมนต์สาธารณะ',
          status: thread.status,
        };
      }
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
