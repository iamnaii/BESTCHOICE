import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * ConversationTagService — manages free-form tags on chat rooms.
 *
 * Tags help staff categorize and filter conversations
 * (e.g. "VIP", "complaint", "refund", "new-customer").
 */
@Injectable()
export class ConversationTagService {
  private readonly logger = new Logger(ConversationTagService.name);

  constructor(private prisma: PrismaService) {}

  /** Add a tag to a room (idempotent — ignores if already exists) */
  async addTag(roomId: string, tag: string): Promise<void> {
    const normalizedTag = tag.trim().toLowerCase();
    try {
      await this.prisma.conversationTag.create({
        data: { roomId, tag: normalizedTag },
      });
    } catch {
      // Unique constraint violation — tag already exists on this room
    }
  }

  /** Add multiple tags at once */
  async addTags(roomId: string, tags: string[]): Promise<void> {
    const normalizedTags = tags.map((t) => t.trim().toLowerCase());
    for (const tag of normalizedTags) {
      await this.addTag(roomId, tag);
    }
  }

  /** Remove a tag from a room */
  async removeTag(roomId: string, tag: string): Promise<void> {
    const normalizedTag = tag.trim().toLowerCase();
    await this.prisma.conversationTag.deleteMany({
      where: { roomId, tag: normalizedTag },
    });
  }

  /** Get all tags for a room */
  async getRoomTags(roomId: string): Promise<string[]> {
    const tags = await this.prisma.conversationTag.findMany({
      where: { roomId },
      select: { tag: true },
      orderBy: { createdAt: 'asc' },
    });
    return tags.map((t) => t.tag);
  }

  /** Get all unique tags across the system (for autocomplete) */
  async getAllUniqueTags(): Promise<string[]> {
    const tags = await this.prisma.conversationTag.findMany({
      distinct: ['tag'],
      select: { tag: true },
      orderBy: { tag: 'asc' },
    });
    return tags.map((t) => t.tag);
  }
}
