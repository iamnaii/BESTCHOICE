import { Inject, Injectable, Logger, NotFoundException, Optional, ForbiddenException } from '@nestjs/common';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../../chat-engine/interfaces/chat-gateway.interface';
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
    @Optional() @Inject(CHAT_GATEWAY_TOKEN) private readonly gateway?: IChatGateway,
  ) {}

  /** Add an internal note to a room */
  async addNote(roomId: string, staffId: string, content: string) {
    const note = await this.prisma.chatNote.create({
      data: { roomId, staffId, content },
      include: {
        staff: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    this.gateway?.emitNoteChanged?.(roomId, { roomId, action: 'added', noteId: note.id });
    return note;
  }

  /** ลบโน้ต (soft) — คนเขียนเอง หรือ OWNER/BRANCH_MANAGER เท่านั้น · ถ้าเป็นโน้ตปักหมุด แถบใต้หัวหายไปด้วย */
  async deleteNote(roomId: string, noteId: string, actor: { id: string; role: string }) {
    const note = await this.prisma.chatNote.findFirst({
      where: { id: noteId, roomId, deletedAt: null },
      select: { id: true, staffId: true },
    });
    if (!note) throw new NotFoundException('ไม่พบโน้ต');
    const isManager = actor.role === 'OWNER' || actor.role === 'BRANCH_MANAGER';
    if (note.staffId !== actor.id && !isManager) {
      throw new ForbiddenException('ลบได้เฉพาะโน้ตของตัวเอง หรือผู้จัดการ');
    }
    await this.prisma.chatNote.update({
      where: { id: noteId },
      data: { deletedAt: new Date(), pinnedAt: null, pinnedById: null },
    });
    this.gateway?.emitNoteChanged?.(roomId, { roomId, action: 'deleted', noteId });
  }

  /** ปักโน้ตเป็นโน้ตของห้อง — ห้องละ 1: ปลดอันเก่าในทรานแซกชันเดียวกัน */
  async pinNote(roomId: string, noteId: string, staffId: string) {
    const note = await this.prisma.chatNote.findFirst({
      where: { id: noteId, roomId, deletedAt: null },
      select: { id: true },
    });
    if (!note) throw new NotFoundException('ไม่พบโน้ต');
    const now = new Date();
    const [, pinned] = await this.prisma.$transaction([
      this.prisma.chatNote.updateMany({
        where: { roomId, pinnedAt: { not: null }, id: { not: noteId } },
        data: { pinnedAt: null, pinnedById: null },
      }),
      this.prisma.chatNote.update({
        where: { id: noteId },
        data: { pinnedAt: now, pinnedById: staffId },
        include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
      }),
    ]);
    this.gateway?.emitNoteChanged?.(roomId, { roomId, action: 'pinned', noteId });
    return pinned;
  }

  async unpinNote(roomId: string, noteId: string) {
    await this.prisma.chatNote.updateMany({
      where: { id: noteId, roomId },
      data: { pinnedAt: null, pinnedById: null },
    });
    this.gateway?.emitNoteChanged?.(roomId, { roomId, action: 'unpinned', noteId });
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
        // includeHidden=true (admin) → show deactivated AND hide-from-chat
        // templates. Default (picker) → only active + not hidden.
        ...(includeHidden ? {} : { isActive: true, hideFromChat: false }),
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
    data: {
      title?: string;
      content?: string;
      category?: string;
      sortOrder?: number;
      isActive?: boolean;
      hideFromChat?: boolean;
      verifiedOnly?: boolean;
    },
  ) {
    // W8: guard against updating a soft-deleted row. Without this, a stale
    // admin client could resurrect a deleted template silently.
    const existing = await this.prisma.cannedResponse.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('ไม่พบข้อความสำเร็จรูป');
    }
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
