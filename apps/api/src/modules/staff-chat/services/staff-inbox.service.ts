import { parseBooleanFlag } from '../../../utils/config.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChatWorkActor, StaffInboxInput, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatWorkAccessService } from './chat-work-access.service';

@Injectable()
export class StaffInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
  ) {}

  async enqueue(
    tx: Prisma.TransactionClient,
    input: StaffInboxInput,
  ): Promise<{ id: string } | null> {
    const toggle = await tx.systemConfig.findFirst({
      where: { key: 'in_app_notifications_enabled', deletedAt: null },
    });
    if (!parseBooleanFlag(toggle?.value, true)) return null;
    // Targets are references, never a client-supplied URL. Later features add their own validated targets.
    if (!input.roomId || !input.title.trim() || input.title.length > 255)
      throw new BadRequestException('ข้อมูลการแจ้งเตือนไม่ถูกต้อง');
    const room = await tx.chatRoom.findFirst({
      where: { id: input.roomId, deletedAt: null },
      select: { channel: true },
    });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');
    const recipient = await tx.user.findFirst({
      where: { id: input.recipientId, deletedAt: null, isActive: true, isSystemUser: false },
    });
    if (!recipient) return null;
    await this.access.assertRoom(
      input.roomId,
      recipient,
      { company: room.channel === 'LINE_FINANCE' ? 'FINANCE' : 'SHOP' },
      tx,
    );
    if (input.todoId) {
      const todo = await tx.todo.findFirst({
        where: { id: input.todoId, roomId: input.roomId, deletedAt: null },
      });
      if (!todo) throw new BadRequestException('งานไม่อยู่ในห้องแชทนี้');
    }
    if (input.targetType === 'ROOM') {
      if (input.targetId !== input.roomId) throw new BadRequestException('ปลายทางไม่ตรงกับห้องแชท');
    } else if (input.targetType === 'TODO') {
      if (!input.todoId || input.targetId !== input.todoId)
        throw new BadRequestException('ปลายทางไม่ตรงกับงาน');
    } else if (input.targetType === 'NOTE') {
      if (
        !(await tx.chatNote.count({
          where: { id: input.targetId, roomId: input.roomId, deletedAt: null },
        }))
      )
        throw new BadRequestException('ไม่พบโน้ตในห้องแชทนี้');
    } else throw new BadRequestException('ยังไม่รองรับปลายทางนี้');
    await tx.staffInboxItem.createMany({ data: [input], skipDuplicates: true });
    const item = await tx.staffInboxItem.findFirst({
      where: {
        dedupeKey: input.dedupeKey,
        recipientId: input.recipientId,
        roomId: input.roomId,
        targetType: input.targetType,
        targetId: input.targetId,
        deletedAt: null,
      },
      select: { id: true },
    });
    return item;
  }

  private async where(
    actor: ChatWorkActor,
    scope: WorkScope,
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.StaffInboxItemWhereInput> {
    const room = await this.access.roomWhere(actor, scope, tx);
    return {
      recipientId: actor.id,
      deletedAt: null,
      room,
      AND: [
        { OR: [{ todoId: null }, { todo: { deletedAt: null, room } }] },
        { targetType: { in: ['ROOM', 'TODO', 'NOTE'] } },
      ],
    };
  }
  async list(actor: ChatWorkActor, scope: WorkScope, page = 1, limit = 50) {
    return this.prisma.$transaction(
      async (tx) => {
        const where = await this.where(actor, scope, tx);
        const [items, total, unreadCount] = await Promise.all([
          tx.staffInboxItem.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
            select: {
              id: true,
              kind: true,
              title: true,
              roomId: true,
              todoId: true,
              targetType: true,
              targetId: true,
              createdAt: true,
              readAt: true,
            },
          }),
          tx.staffInboxItem.count({ where }),
          tx.staffInboxItem.count({ where: { AND: [where, { readAt: null }] } }),
        ]);
        const noteIds = items
          .filter((item) => item.targetType === 'NOTE')
          .map((item) => item.targetId);
        const notes = await tx.chatNote.findMany({
          where: { id: { in: noteIds }, deletedAt: null },
          select: { id: true },
        });
        const liveNotes = new Set(notes.map((note) => note.id));
        const data = items.map((item) =>
          item.targetType === 'NOTE' && !liveNotes.has(item.targetId)
            ? { ...item, title: 'โน้ตถูกลบ', targetDeleted: true }
            : { ...item, targetDeleted: false },
        );
        return { data, total, page, limit, unreadCount };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async markRead(id: string, actor: ChatWorkActor, scope: WorkScope) {
    return this.prisma.$transaction(async (tx) => {
      const where = await this.where(actor, scope, tx);
      const item = await tx.staffInboxItem.findFirst({
        where: { AND: [where, { id }] },
        select: { id: true, readAt: true },
      });
      if (!item) throw new NotFoundException('ไม่พบการแจ้งเตือน');
      if (!item.readAt)
        await tx.staffInboxItem.updateMany({
          where: { AND: [where, { id, readAt: null }] },
          data: { readAt: new Date() },
        });
      return { id, read: true };
    });
  }
}
