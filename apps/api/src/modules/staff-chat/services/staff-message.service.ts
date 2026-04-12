import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * StaffMessageService — manages staff notes and canned responses.
 */
@Injectable()
export class StaffMessageService {
  private readonly logger = new Logger(StaffMessageService.name);

  constructor(private prisma: PrismaService) {}

  /** Add an internal note to a session */
  async addNote(sessionId: string, staffId: string, content: string) {
    return this.prisma.chatNote.create({
      data: { sessionId, staffId, content },
      include: {
        staff: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /** Get all notes for a session */
  async getNotes(sessionId: string) {
    return this.prisma.chatNote.findMany({
      where: { sessionId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        staff: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /** Get canned responses, optionally filtered by category */
  async getCannedResponses(category?: string) {
    return this.prisma.cannedResponse.findMany({
      where: {
        deletedAt: null,
        isActive: true,
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
}
