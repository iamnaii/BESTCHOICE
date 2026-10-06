import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseBooleanFlag } from '../../../utils/config.util';
import {
  CHAT_GATEWAY_TOKEN,
  IChatGateway,
} from '../../chat-engine/interfaces/chat-gateway.interface';
import { ChatWorkAccessService } from './chat-work-access.service';
import { StaffInboxService } from './staff-inbox.service';
import { CreateRoomNoteDto } from '../dto/create-room-note.dto';
export const mentionKey = (noteId: string, userId: string) => `mention:${noteId}:${userId}`;
@Injectable()
export class NoteMentionService {
  private readonly logger = new Logger(NoteMentionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
    private readonly inbox: StaffInboxService,
    @Optional() @Inject(CHAT_GATEWAY_TOKEN) private readonly gateway?: IChatGateway,
  ) {}
  async create(
    roomId: string,
    input: CreateRoomNoteDto,
    authenticated: ChatWorkActor,
    scope: WorkScope,
  ) {
    if (
      typeof input.content !== 'string' ||
      !input.content.trim() ||
      input.content.trim().length > 5000
    )
      throw new BadRequestException('กรุณาระบุโน้ต 1–5,000 ตัวอักษร');
    const recipients = [...new Set(input.mentionedUserIds ?? [])];
    if (recipients.length > 20) throw new BadRequestException('เรียกเพื่อนได้ไม่เกิน 20 คน');
    const result = await this.prisma.$transaction(async (tx) => {
      const actor = await this.access.currentActor(authenticated, tx);
      await this.access.assertRoom(roomId, actor, scope, tx);
      await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${roomId} FOR UPDATE`;
      await this.access.assertRoom(roomId, actor, scope, tx);
      // Explicit IDs only. Display names and @text never grant or infer recipients.
      for (const id of recipients) {
        const user = await tx.user.findFirst({
          where: { id, deletedAt: null, isActive: true, isSystemUser: false },
        });
        if (!user) throw new ForbiddenException('ผู้รับที่เลือกไม่พร้อมใช้งาน กรุณาเลือกใหม่');
        try {
          await this.access.assertRoom(roomId, user, scope, tx);
        } catch (error) {
          if (!(error instanceof ForbiddenException) && !(error instanceof NotFoundException))
            throw error;
          throw new ForbiddenException('ผู้รับที่เลือกไม่มีสิทธิ์ห้องนี้แล้ว กรุณาเลือกใหม่');
        }
      }
      const requestKey = input.clientRequestId
        ? `note:${roomId}:${actor.id}:${input.clientRequestId}`
        : null;
      const id = randomUUID();
      const created = await tx.chatNote.createMany({
        data: [{ id, requestKey, roomId, staffId: actor.id, content: input.content.trim() }],
        skipDuplicates: true,
      });
      const note = await tx.chatNote.findFirstOrThrow({
        where: requestKey ? { requestKey } : { id },
        include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
      });
      if (note.deletedAt) throw new ConflictException('โน้ตนี้ถูกลบแล้ว กรุณาเริ่มโน้ตใหม่');
      if (!created.count) return { note, recipients: [] as string[], created: false };
      await tx.chatNoteMention.createMany({
        data: recipients.map((userId) => ({ noteId: note.id, userId })),
        skipDuplicates: true,
      });
      const flag = await tx.systemConfig.findFirst({
        where: { key: 'chat_mentions_enabled', deletedAt: null },
      });
      const notified: string[] = [];
      if (parseBooleanFlag(flag?.value, false))
        for (const recipientId of recipients) {
          const item = await this.inbox.enqueue(tx, {
            recipientId,
            roomId,
            kind: 'MENTION',
            dedupeKey: mentionKey(note.id, recipientId),
            title: 'มีโน้ตเรียกถึงคุณ',
            targetType: 'NOTE',
            targetId: note.id,
          });
          if (item) notified.push(recipientId);
        }
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CHAT_NOTE_CREATED',
          entity: 'ChatNote',
          entityId: note.id,
          newValue: { roomId, mentionedUserIds: recipients },
        },
      });
      return { note, recipients: notified, created: true };
    });
    // Socket hints happen only after commit; no internal note ever reaches a channel adapter.
    if (result.created)
      try {
        this.gateway?.emitNoteChanged?.(roomId, {
          roomId,
          action: 'added',
          noteId: result.note.id,
        });
        for (const userId of result.recipients)
          this.gateway?.emitToStaff(userId, 'chat:work:update', { roomId });
      } catch (error) {
        this.logger.warn(
          `Committed note notification hint failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    return result.note;
  }
}
