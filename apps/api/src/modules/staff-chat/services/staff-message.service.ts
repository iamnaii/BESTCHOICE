import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CannedResponseVariableService } from './canned-response-variable.service';

/**
 * StaffMessageService — manages staff notes and canned responses.
 */
@Injectable()
export class StaffMessageService {
  private readonly logger = new Logger(StaffMessageService.name);

  constructor(
    private prisma: PrismaService,
    private cannedResponseVariableService: CannedResponseVariableService,
  ) {}

  /** Add an internal note to a room */
  async addNote(roomId: string, staffId: string, content: string) {
    return this.prisma.chatNote.create({
      data: { roomId, staffId, content },
      include: {
        staff: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /** Get all notes for a room */
  async getNotes(roomId: string) {
    return this.prisma.chatNote.findMany({
      where: { roomId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        staff: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /** Get canned responses, optionally filtered by category.
   * `includeHidden=true` is used by admin pages to show templates flagged
   * `hideFromChat` (which would otherwise be excluded from the chat picker).
   */
  async getCannedResponses(category?: string, includeHidden = false) {
    return this.prisma.cannedResponse.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(includeHidden ? {} : { hideFromChat: false }),
        ...(category ? { category } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
  }

  /** Create a canned response */
  async createCannedResponse(data: {
    shortcut: string;
    title: string;
    content: string;
    category?: string;
    sortOrder?: number;
  }) {
    return this.prisma.cannedResponse.create({ data });
  }

  /** Update a canned response */
  async updateCannedResponse(
    id: string,
    data: { title?: string; content?: string; category?: string; sortOrder?: number; isActive?: boolean },
  ) {
    return this.prisma.cannedResponse.update({ where: { id }, data });
  }

  /** Soft-delete a canned response */
  async deleteCannedResponse(id: string) {
    return this.prisma.cannedResponse.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Bulk reorder canned responses — used by admin drag-and-drop */
  async reorderCannedResponses(
    items: Array<{ id: string; sortOrder: number; category: string | null }>,
  ): Promise<{ updated: number }> {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.cannedResponse.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder, category: item.category },
        }),
      ),
    );
    return { updated: items.length };
  }

  /** Get a canned response with variables expanded using session context */
  async getCannedResponseExpanded(id: string, roomId: string) {
    // 1. Find canned response by id — must be active + not soft-deleted
    //    (matches getCannedResponses list filter so deactivated templates
    //     are not reachable via preview either)
    const cannedResponse = await this.prisma.cannedResponse.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: {
        bubbles: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        quickReplies: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!cannedResponse) {
      throw new NotFoundException('ไม่พบข้อความสำเร็จรูป');
    }

    // 2. Find room to get customerId — skip soft-deleted rooms
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
      select: { id: true, customerId: true },
    });

    const customerId = room?.customerId ?? undefined;

    // 3. Expand variables on bubble TEXT entries
    const expandedBubbles = await Promise.all(
      cannedResponse.bubbles.map(async (b: any) => {
        if (b.type === 'TEXT' && b.text) {
          return {
            ...b,
            text: await this.cannedResponseVariableService.expandVariables(b.text, {
              roomId,
              customerId,
            }),
          };
        }
        return b;
      }),
    );

    // 4. Expand legacy single-content field
    const expandedContent = cannedResponse.content
      ? await this.cannedResponseVariableService.expandVariables(cannedResponse.content, {
          roomId,
          customerId,
        })
      : '';

    // 5. Return original + expanded + bubbles + quick replies (Phase 2)
    return {
      id: cannedResponse.id,
      shortcut: cannedResponse.shortcut,
      title: cannedResponse.title,
      content: cannedResponse.content,
      expandedContent,
      bubbles: expandedBubbles,
      quickReplies: cannedResponse.quickReplies,
    };
  }
}
