import { parseBooleanFlag } from '../../../utils/config.util';
import type { CreateTodoDto, UpdateTodoDto } from '../../todos/dto/todo.dto';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ChatWorkKind, Prisma, Todo, TodoStatus } from '@prisma/client';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatWorkAccessService } from './chat-work-access.service';
import { StaffInboxService } from './staff-inbox.service';
import { CreateChatFollowUpDto, UpdateChatFollowUpDto } from '../dto/chat-follow-up.dto';

const taskInclude = {
  assignee: { select: { id: true, name: true, nickname: true, avatarUrl: true } },
  createdBy: { select: { id: true, name: true, nickname: true, avatarUrl: true } },
} as const;
const activeStatuses: TodoStatus[] = ['TODO', 'DOING', 'REVIEW'];
export interface RoomTaskInput {
  title: string;
  assigneeId: string | null;
  dueAt: string | null;
  clientRequestId?: string;
  description?: string;
  priority?: Todo['priority'];
  status?: TodoStatus;
  tags?: string[];
  checklist?: Prisma.InputJsonValue;
  attachments?: Prisma.InputJsonValue;
}
export interface RoomTaskPatch extends Partial<Omit<RoomTaskInput, 'clientRequestId'>> {
  expectedRevision: number;
}
@Injectable()
export class ChatFollowUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
    private readonly inbox: StaffInboxService,
  ) {}
  private async gate(tx: Prisma.TransactionClient, kind: ChatWorkKind) {
    if (kind === 'GENERAL') return;
    const key =
      kind === 'CHAT_FOLLOW_UP'
        ? 'chat_follow_up_enabled'
        : kind === 'CHAT_HANDOFF'
          ? 'chat_mentions_enabled'
          : 'chat_service_requests_enabled';
    if (
      !parseBooleanFlag(
        (await tx.systemConfig.findFirst({ where: { key, deletedAt: null } }))?.value,
        false,
      )
    )
      throw new ForbiddenException('ยังไม่เปิดใช้งานส่วนนี้');
  }
  private title(value: string) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 255)
      throw new BadRequestException('กรุณาระบุชื่องานไม่เกิน 255 ตัวอักษร');
    return value.trim();
  }
  private date(value: string | null) {
    if (value === null) return null;
    const date = new Date(value);
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(date.getTime()))
      throw new BadRequestException('กรุณาระบุวันเวลาและเขตเวลาให้ถูกต้อง');
    return date;
  }
  private async assignee(
    tx: Prisma.TransactionClient,
    id: string | null,
    roomId: string,
    scope: WorkScope,
  ) {
    if (!id) return null;
    const user = await tx.user.findFirst({
      where: { id, deletedAt: null, isActive: true, isSystemUser: false },
    });
    if (!user) throw new BadRequestException('ผู้รับงานไม่พร้อมใช้งาน');
    await this.access.assertRoom(roomId, user, scope, tx);
    return user;
  }
  private async lockRoom(tx: Prisma.TransactionClient, roomId: string) {
    await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${roomId} AND deleted_at IS NULL FOR UPDATE`;
  }
  async context(roomId: string, actorId: string, company?: WorkScope['company']) {
    const actor = await this.access.currentActor({ id: actorId });
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
      select: { channel: true },
    });
    const scope: WorkScope = {
      company: company ?? (room?.channel === 'LINE_FINANCE' ? 'FINANCE' : 'SHOP'),
    };
    await this.access.assertRoom(roomId, actor, scope);
    return { actor, scope };
  }
  private legacyDate(value: string | null | undefined) {
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+07:00` : value;
  }
  async createLegacy(input: CreateTodoDto, actorId: string, company?: WorkScope['company']) {
    const { actor, scope } = await this.context(input.roomId!, actorId, company);
    const data: RoomTaskInput = {
      ...input,
      title: input.title,
      assigneeId: input.assigneeId ?? null,
      dueAt: this.legacyDate(input.dueDate) ?? null,
      checklist: input.checklist as unknown as Prisma.InputJsonValue,
      attachments: input.attachments as unknown as Prisma.InputJsonValue,
    };
    return this.prisma.$transaction((tx) =>
      this.createInTx(tx, input.roomId!, data, actor, scope, 'GENERAL'),
    );
  }
  async updateLegacy(
    task: Todo,
    input: UpdateTodoDto,
    actorId: string,
    company?: WorkScope['company'],
  ) {
    if (input.roomId !== undefined && input.roomId !== task.roomId)
      throw new BadRequestException(
        'ไม่สามารถย้ายหรือปลดงานออกจากห้องเดิม กรุณาสร้างงานในห้องปลายทาง',
      );
    const { actor, scope } = await this.context(task.roomId!, actorId, company);
    const data: RoomTaskPatch = {
      ...input,
      expectedRevision: input.expectedRevision!,
      dueAt: this.legacyDate(input.dueDate),
      checklist: input.checklist as unknown as Prisma.InputJsonValue,
      attachments: input.attachments as unknown as Prisma.InputJsonValue,
    };
    return this.prisma.$transaction((tx) =>
      this.updateInTx(tx, task.id, data, actor, scope, ['GENERAL', 'CHAT_FOLLOW_UP']),
    );
  }
  create(roomId: string, input: CreateChatFollowUpDto, actor: ChatWorkActor, scope: WorkScope) {
    return this.prisma.$transaction((tx) =>
      this.createInTx(tx, roomId, input, actor, scope, 'CHAT_FOLLOW_UP'),
    );
  }
  /** Internal composition for handoff/service intake; workKind is never accepted from a request DTO. */
  async createInTx(
    tx: Prisma.TransactionClient,
    roomId: string,
    input: RoomTaskInput,
    authenticated: ChatWorkActor,
    scope: WorkScope,
    kind: ChatWorkKind,
  ) {
    await this.lockRoom(tx, roomId);
    const actor = await this.access.currentActor(authenticated, tx);
    await this.access.assertRoom(roomId, actor, scope, tx);
    await this.gate(tx, kind);
    const title = this.title(input.title);
    const dueDate = this.date(input.dueAt);
    if (kind !== 'GENERAL' && (!dueDate || !input.assigneeId || !input.clientRequestId))
      throw new BadRequestException('กรุณาระบุผู้รับงาน วันเวลา และรหัสคำขอ');
    const assignee = await this.assignee(tx, input.assigneeId, roomId, scope);
    const requestKey = input.clientRequestId
      ? `chat-todo:${actor.id}:${input.clientRequestId}`
      : null;
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          roomId,
          company: scope.company,
          kind,
          title,
          dueAt: dueDate?.toISOString() ?? null,
          assigneeId: input.assigneeId,
          description: input.description?.trim() || null,
          priority: input.priority ?? 'MEDIUM',
          status: input.status ?? 'TODO',
          tags: input.tags ?? [],
          checklist: input.checklist ?? null,
          attachments: input.attachments ?? null,
        }),
      )
      .digest('hex');
    const id = randomUUID();
    const created = await tx.todo.createMany({
      data: [
        {
          id,
          title,
          roomId,
          workKind: kind,
          requestKey,
          requestFingerprint,
          createdById: actor.id,
          assigneeId: input.assigneeId,
          branchId: assignee?.branchId ?? actor.branchId,
          dueDate,
          description: input.description,
          priority: input.priority ?? 'MEDIUM',
          status: input.status ?? 'TODO',
          completedAt: input.status === 'DONE' ? new Date() : null,
          tags: input.tags ?? [],
          checklist: input.checklist,
          attachments: input.attachments,
        },
      ],
      skipDuplicates: true,
    });
    const task = await tx.todo.findFirst({
      where: requestKey ? { requestKey } : { id },
      include: taskInclude,
    });
    if (!task || task.roomId !== roomId || task.workKind !== kind || task.deletedAt)
      throw new ConflictException('รหัสคำขอนี้ถูกใช้กับงานอื่นแล้ว');
    if (created.count === 0) {
      if (task.requestFingerprint !== requestFingerprint)
        throw new ConflictException({
          statusCode: 409,
          code: 'CHAT_TASK_REQUEST_MISMATCH',
          taskId: task.id,
          message: 'รหัสคำขอนี้บันทึกงานไปแล้ว แต่รายละเอียดเปลี่ยนไป กรุณาโหลดงานเดิมเพื่อแก้ไข',
        });
      return task;
    }
    await this.history(tx, actor.id, null, task);
    if (task.assigneeId && activeStatuses.includes(task.status))
      await this.notify(tx, task, 'created');
    return task;
  }
  update(id: string, input: UpdateChatFollowUpDto, actor: ChatWorkActor, scope: WorkScope) {
    return this.prisma.$transaction((tx) =>
      this.updateInTx(tx, id, input, actor, scope, ['CHAT_FOLLOW_UP']),
    );
  }
  /** Every room-task writer uses CAS and this append-only history. Domain services choose allowed kinds/transitions. */
  async updateInTx(
    tx: Prisma.TransactionClient,
    id: string,
    input: RoomTaskPatch,
    authenticated: ChatWorkActor,
    scope: WorkScope,
    allowedKinds: ChatWorkKind[],
  ) {
    const initial = await this.access.assertTodo(id, authenticated, scope, tx);
    await this.lockRoom(tx, initial.roomId!);
    const actor = await this.access.currentActor(authenticated, tx);
    const before = await this.access.assertTodo(id, actor, scope, tx);
    if (before.roomId !== initial.roomId)
      throw new ConflictException('ห้องของงานเปลี่ยนไป กรุณาโหลดใหม่');
    if (!allowedKinds.includes(before.workKind))
      throw new ForbiddenException('กรุณาดำเนินการงานชนิดนี้จากหน้าแชท');
    await this.gate(tx, before.workKind);
    if (
      !['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(actor.role) &&
      before.createdById !== actor.id &&
      before.assigneeId !== actor.id
    )
      throw new ForbiddenException('เฉพาะผู้สร้าง ผู้รับงาน หรือผู้จัดการที่แก้ไขงานนี้ได้');
    if (
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision !== before.revision
    )
      throw new ConflictException('งานนี้มีการแก้ไขแล้ว กรุณาโหลดใหม่');
    const assigneeId = input.assigneeId === undefined ? before.assigneeId : input.assigneeId;
    const dueDate = input.dueAt === undefined ? before.dueDate : this.date(input.dueAt);
    if (before.workKind !== 'GENERAL' && (!dueDate || !assigneeId))
      throw new BadRequestException('งานนี้ต้องมีผู้รับงานและกำหนดเวลา');
    const status = input.status ?? before.status;
    // A scoped creator/manager must be able to cancel an orphan without reassigning it.
    const recipient =
      status === 'CANCELLED' && assigneeId === before.assigneeId
        ? null
        : await this.assignee(tx, assigneeId, before.roomId!, scope);
    if (!['TODO', 'DOING', 'REVIEW', 'DONE', 'CANCELLED'].includes(status))
      throw new BadRequestException('สถานะงานไม่ถูกต้อง');
    const changedDue = (before.dueDate?.getTime() ?? null) !== (dueDate?.getTime() ?? null);
    const update = await tx.todo.updateMany({
      where: { id, roomId: before.roomId, revision: input.expectedRevision, deletedAt: null },
      data: {
        title: input.title === undefined ? before.title : this.title(input.title),
        dueDate,
        assigneeId,
        branchId: recipient?.branchId ?? before.branchId,
        status,
        completedAt: status === 'DONE' ? (before.completedAt ?? new Date()) : null,
        description: input.description,
        priority: input.priority,
        tags: input.tags,
        checklist: input.checklist,
        attachments: input.attachments,
        revision: { increment: 1 },
        ...(changedDue ? { dueRevision: { increment: 1 } } : {}),
      },
    });
    if (update.count !== 1) throw new ConflictException('งานนี้มีการแก้ไขแล้ว กรุณาโหลดใหม่');
    const task = await tx.todo.findUniqueOrThrow({ where: { id }, include: taskInclude });
    await this.history(tx, actor.id, before, task);
    if (
      task.assigneeId &&
      activeStatuses.includes(task.status) &&
      (changedDue ||
        before.assigneeId !== task.assigneeId ||
        !activeStatuses.includes(before.status))
    )
      await this.notify(tx, task, `updated:${task.revision}`);
    return task;
  }
  private async notify(tx: Prisma.TransactionClient, task: Todo, change: string) {
    await this.inbox.enqueue(tx, {
      recipientId: task.assigneeId!,
      roomId: task.roomId!,
      todoId: task.id,
      kind:
        task.workKind === 'CHAT_HANDOFF'
          ? 'HANDOFF'
          : task.workKind === 'CHAT_SERVICE'
            ? 'SERVICE_REQUEST'
            : 'FOLLOW_UP',
      dedupeKey: `work:${task.id}:${change}:${task.assigneeId}`,
      title: 'มีงานในแชทถึงคุณ',
      targetType: 'TODO',
      targetId: task.id,
    });
  }
  private async history(
    tx: Prisma.TransactionClient,
    actorId: string,
    before: Todo | null,
    after: Todo,
  ) {
    const kind = !before
      ? 'CREATED'
      : before.status !== after.status
        ? 'STATUS_CHANGED'
        : before.dueDate?.getTime() !== after.dueDate?.getTime()
          ? 'RESCHEDULED'
          : before.assigneeId !== after.assigneeId
            ? 'REASSIGNED'
            : 'UPDATED';
    await tx.todoWorkEvent.create({
      data: {
        todoId: after.id,
        actorId,
        kind,
        fromDueAt: before?.dueDate,
        toDueAt: after.dueDate,
        fromAssigneeId: before?.assigneeId,
        toAssigneeId: after.assigneeId,
        fromStatus: before?.status,
        toStatus: after.status,
      },
    });
    const snapshot = (task: Todo) => ({
      status: task.status,
      dueAt: task.dueDate?.toISOString() ?? null,
      assigneeId: task.assigneeId,
      revision: task.revision,
      dueRevision: task.dueRevision,
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: `CHAT_TASK_${kind}`,
        entity: 'Todo',
        entityId: after.id,
        oldValue: before ? snapshot(before) : Prisma.JsonNull,
        newValue: snapshot(after),
      },
    });
  }
}
