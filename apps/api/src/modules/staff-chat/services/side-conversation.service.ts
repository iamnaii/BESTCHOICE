import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SideConversationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Add a side message (internal staff-only note) to a chat session.
   */
  async addMessage(roomId: string, staffId: string, text: string) {
    // Verify room exists
    const session = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
    });
    if (!session) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    return this.prisma.chatSideMessage.create({
      data: {
        roomId,
        staffId,
        text,
      },
      include: {
        staff: {
          select: { id: true, name: true, role: true },
        },
      },
    });
  }

  /**
   * Get all non-deleted side messages for a session, ordered by createdAt asc.
   */
  async getMessages(roomId: string) {
    return this.prisma.chatSideMessage.findMany({
      where: {
        roomId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        staff: {
          select: { id: true, name: true, role: true },
        },
      },
    });
  }

  /**
   * Soft delete a side message.
   */
  async deleteMessage(id: string) {
    const message = await this.prisma.chatSideMessage.findUnique({
      where: { id },
    });
    if (!message || message.deletedAt) {
      throw new NotFoundException('ไม่พบข้อความ');
    }

    return this.prisma.chatSideMessage.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
