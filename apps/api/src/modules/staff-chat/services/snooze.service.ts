import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * SnoozeService — manages chat snooze/follow-up reminders.
 *
 * Staff can snooze a chat session to be reminded later,
 * e.g. "follow up with this customer in 2 hours".
 */
@Injectable()
export class SnoozeService {
  private readonly logger = new Logger(SnoozeService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a snooze reminder for a chat session.
   */
  async createSnooze(
    roomId: string,
    staffId: string,
    remindAt: Date,
    note?: string,
  ) {
    // Verify room exists
    const session = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
    });
    if (!session) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    const snooze = await this.prisma.chatSnooze.create({
      data: {
        roomId,
        staffId,
        remindAt,
        note: note || null,
      },
      include: {
        room: {
          select: {
            id: true,
            channel: true,
            roomStatus: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    this.logger.log(
      `[Snooze] Created snooze ${snooze.id} for room ${roomId}, remind at ${remindAt.toISOString()}`,
    );

    return snooze;
  }

  /**
   * Cancel (complete) a snooze by marking it as completed.
   */
  async cancelSnooze(snoozeId: string): Promise<void> {
    const snooze = await this.prisma.chatSnooze.findUnique({
      where: { id: snoozeId },
    });
    if (!snooze) {
      throw new NotFoundException('ไม่พบการตั้งเตือน');
    }

    await this.prisma.chatSnooze.update({
      where: { id: snoozeId },
      data: { completed: true },
    });

    this.logger.log(`[Snooze] Cancelled snooze ${snoozeId}`);
  }

  /**
   * Get all active (not completed, not yet fired) snoozes for a staff member.
   */
  async getActiveSnoozes(staffId: string) {
    return this.prisma.chatSnooze.findMany({
      where: {
        staffId,
        completed: false,
      },
      include: {
        room: {
          select: {
            id: true,
            channel: true,
            roomStatus: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { remindAt: 'asc' },
    });
  }

  /**
   * Get all snoozes for a specific room.
   */
  async getRoomSnoozes(roomId: string) {
    return this.prisma.chatSnooze.findMany({
      where: { roomId },
      include: {
        staff: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
