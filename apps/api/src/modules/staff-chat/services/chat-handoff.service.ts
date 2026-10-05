import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { TodoStatus } from '@prisma/client';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CHAT_GATEWAY_TOKEN,
  IChatGateway,
} from '../../chat-engine/interfaces/chat-gateway.interface';
import { ChatWorkAccessService } from './chat-work-access.service';
import { ChatFollowUpService } from './chat-follow-up.service';
import { StaffInboxService } from './staff-inbox.service';
import { CreateChatHandoffDto, UpdateChatHandoffDto } from '../dto/chat-handoff.dto';
export function handoffTransition(
  status: TodoStatus,
  action: UpdateChatHandoffDto['action'],
): TodoStatus {
  const transitions: Partial<
    Record<TodoStatus, Partial<Record<UpdateChatHandoffDto['action'], TodoStatus>>>
  > = {
    TODO: { ACCEPT: 'DOING', CANCEL: 'CANCELLED' },
    DOING: { COMPLETE: 'DONE', CANCEL: 'CANCELLED' },
  };
  const next = transitions[status]?.[action];
  if (!next) throw new ConflictException('สถานะงานเปลี่ยนไป กรุณาโหลดล่าสุด ต้องรับงานก่อนจบงาน');
  return next;
}
@Injectable()
export class ChatHandoffService {
  private readonly logger = new Logger(ChatHandoffService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
    private readonly tasks: ChatFollowUpService,
    private readonly inbox: StaffInboxService,
    @Optional() @Inject(CHAT_GATEWAY_TOKEN) private readonly gateway?: IChatGateway,
  ) {}
  async create(
    roomId: string,
    input: CreateChatHandoffDto,
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    const task = await this.prisma.$transaction((tx) =>
      this.tasks.createInTx(
        tx,
        roomId,
        { ...input, description: input.note },
        actor,
        scope,
        'CHAT_HANDOFF',
      ),
    );
    this.hint([actor.id, task.assigneeId!]);
    return task;
  }
  async update(
    id: string,
    input: UpdateChatHandoffDto,
    authenticated: ChatWorkActor,
    scope: WorkScope,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const initial = await this.access.assertTodo(id, authenticated, scope, tx);
      await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${initial.roomId} FOR UPDATE`;
      const actor = await this.access.currentActor(authenticated, tx);
      const before = await this.access.assertTodo(id, actor, scope, tx);
      if (before.roomId !== initial.roomId)
        throw new ConflictException('ห้องของงานเปลี่ยนไป กรุณาโหลดใหม่');
      if (before.workKind !== 'CHAT_HANDOFF') throw new NotFoundException('ไม่พบงานที่ฝาก');
      if (input.action === 'CANCEL') {
        if (
          before.createdById !== actor.id &&
          !['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(actor.role)
        )
          throw new ForbiddenException('เฉพาะผู้ฝากหรือผู้จัดการที่ยกเลิกงานได้');
      } else if (before.assigneeId !== actor.id)
        throw new ForbiddenException('เฉพาะผู้รับงานที่รับและจบงานนี้ได้');
      const status = handoffTransition(before.status, input.action);
      const task = await this.tasks.updateInTx(
        tx,
        id,
        { expectedRevision: input.expectedRevision, status },
        actor,
        scope,
        ['CHAT_HANDOFF'],
      );
      if (input.action === 'COMPLETE' && input.completionNote?.trim())
        await tx.todoComment.create({
          data: { todoId: task.id, userId: actor.id, content: input.completionNote.trim() },
        });
      const recipients = [actor.id];
      if (input.action === 'COMPLETE') {
        const creator = await tx.user.findFirst({
          where: { id: task.createdById, deletedAt: null, isActive: true, isSystemUser: false },
        });
        if (creator) {
          let eligible = true;
          try {
            await this.access.assertRoom(task.roomId!, creator, scope, tx);
          } catch (error) {
            if (error instanceof ForbiddenException || error instanceof NotFoundException)
              eligible = false;
            else throw error;
          }
          if (eligible) {
            const notice = await this.inbox.enqueue(tx, {
              recipientId: creator.id,
              roomId: task.roomId!,
              todoId: task.id,
              kind: 'HANDOFF',
              title: 'งานที่คุณฝากเสร็จแล้ว',
              targetType: 'TODO',
              targetId: task.id,
              dedupeKey: `handoff:${task.id}:${task.revision}:${creator.id}`,
            });
            if (notice) recipients.push(creator.id);
          }
        }
      }
      return { task, recipients };
    });
    this.hint(result.recipients);
    return result.task;
  }
  private hint(recipients: string[]) {
    try {
      for (const id of new Set(recipients)) this.gateway?.emitToStaff(id, 'chat:work:update', {});
    } catch (error) {
      this.logger.warn(
        `Committed handoff hint failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
