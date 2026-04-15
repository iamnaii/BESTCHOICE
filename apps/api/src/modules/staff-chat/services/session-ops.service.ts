import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * SessionOpsService — ticket linking & conversation merge for staff chat.
 *
 * - Create a Todo/ticket from a chat room (copies last 5 messages as context)
 * - Merge two rooms (move messages, notes, tags from secondary → primary)
 */
@Injectable()
export class SessionOpsService {
  private readonly logger = new Logger(SessionOpsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a Todo/ticket from a chat room.
   * Builds title from customer name and description from last 5 messages.
   */
  async createTicketFromRoom(roomId: string, staffId: string) {
    const session = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true, nickname: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { role: true, text: true, createdAt: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    const customerName = session.customer
      ? (session.customer.nickname || session.customer.name)
      : session.lineUserId;

    const title = `แชท: ${customerName}`;

    // Build description from last 5 messages (oldest first)
    const recentMessages = [...session.messages].reverse();
    const description = recentMessages
      .map((m) => `${m.role}: ${m.text ?? '(สื่อ)'}`)
      .join('\n');

    const todo = await this.prisma.todo.create({
      data: {
        title,
        description: description || null,
        status: 'TODO',
        priority: 'MEDIUM',
        createdById: staffId,
        assigneeId: staffId,
      },
    });

    this.logger.log(
      `Ticket created from room ${roomId}: todo=${todo.id} by staff=${staffId}`,
    );

    return todo;
  }

  /**
   * Merge two rooms — move all data from secondary into primary.
   * Secondary room is soft-deleted after merge.
   */
  async mergeRooms(primaryId: string, secondaryId: string) {
    if (primaryId === secondaryId) {
      throw new BadRequestException('ไม่สามารถรวมห้องแชทเดียวกันได้');
    }

    const [primary, secondary] = await Promise.all([
      this.prisma.chatRoom.findFirst({
        where: { id: primaryId, deletedAt: null },
      }),
      this.prisma.chatRoom.findFirst({
        where: { id: secondaryId, deletedAt: null },
      }),
    ]);

    if (!primary) {
      throw new NotFoundException('ไม่พบห้องแชทหลัก');
    }
    if (!secondary) {
      throw new NotFoundException('ไม่พบห้องแชทรอง');
    }

    // Validate same customer (or secondary has no customer)
    if (
      secondary.customerId &&
      primary.customerId &&
      secondary.customerId !== primary.customerId
    ) {
      throw new BadRequestException(
        'ไม่สามารถรวมเซสชันที่เป็นของลูกค้าคนละคนได้',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // a. Move ChatMessages from secondary → primary
      await tx.chatMessage.updateMany({
        where: { roomId: secondaryId },
        data: { roomId: primaryId },
      });

      // b. Move ChatNotes from secondary → primary
      await tx.chatNote.updateMany({
        where: { roomId: secondaryId },
        data: { roomId: primaryId },
      });

      // c. Move ConversationTags — skip duplicates via unique constraint
      const secondaryTags = await tx.conversationTag.findMany({
        where: { roomId: secondaryId },
      });

      for (const tag of secondaryTags) {
        try {
          await tx.conversationTag.update({
            where: { id: tag.id },
            data: { roomId: primaryId },
          });
        } catch {
          // Unique constraint violation (roomId, tag) — duplicate tag, delete it
          await tx.conversationTag.delete({ where: { id: tag.id } });
        }
      }

      // d. Recalculate primary totalMessages
      const messageCount = await tx.chatMessage.count({
        where: { roomId: primaryId, deletedAt: null },
      });
      await tx.chatRoom.update({
        where: { id: primaryId },
        data: { totalMessages: messageCount },
      });

      // e. Soft-delete secondary room
      await tx.chatRoom.update({
        where: { id: secondaryId },
        data: { deletedAt: new Date() },
      });
    });

    this.logger.log(
      `Rooms merged: secondary=${secondaryId} → primary=${primaryId}`,
    );
  }
}
