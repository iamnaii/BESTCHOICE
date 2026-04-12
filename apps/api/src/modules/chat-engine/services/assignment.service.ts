import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatSessionStatus } from '@prisma/client';

/**
 * AssignmentService — manages staff ↔ session assignment.
 *
 * Handles assign, transfer (re-assign), and resolve operations.
 * In Phase 2, these actions will emit WebSocket events.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(private prisma: PrismaService) {}

  /** Assign a session to a staff member */
  async assign(sessionId: string, staffId: string): Promise<void> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, assignedToId: true },
    });
    if (!session) throw new NotFoundException('ไม่พบ session');

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        assignedToId: staffId,
        sessionStatus: ChatSessionStatus.PENDING,
      },
    });

    // Log activity
    await this.prisma.staffChatActivity.create({
      data: {
        staffId,
        action: 'assign',
        metadata: { sessionId },
      },
    });

    this.logger.log(`Session ${sessionId} assigned to staff ${staffId}`);
    // TODO Phase 2: emit WS chat:assigned event
  }

  /** Transfer a session from one staff to another */
  async transfer(
    sessionId: string,
    fromStaffId: string,
    toStaffId: string,
  ): Promise<void> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, assignedToId: true },
    });
    if (!session) throw new NotFoundException('ไม่พบ session');

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { assignedToId: toStaffId },
    });

    // Log both sides of the transfer
    await this.prisma.staffChatActivity.createMany({
      data: [
        {
          staffId: fromStaffId,
          action: 'transfer_out',
          metadata: { sessionId, toStaffId },
        },
        {
          staffId: toStaffId,
          action: 'transfer_in',
          metadata: { sessionId, fromStaffId },
        },
      ],
    });

    this.logger.log(
      `Session ${sessionId} transferred from ${fromStaffId} to ${toStaffId}`,
    );
    // TODO Phase 2: emit WS chat:assigned event to both staff
  }

  /** Resolve/close a session */
  async resolve(sessionId: string, staffId: string): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        sessionStatus: ChatSessionStatus.RESOLVED,
        handoffMode: false,
        resolvedAt: new Date(),
      },
    });

    await this.prisma.staffChatActivity.create({
      data: {
        staffId,
        action: 'resolve',
        metadata: { sessionId },
      },
    });

    this.logger.log(`Session ${sessionId} resolved by staff ${staffId}`);
    // TODO Phase 2: emit WS chat:resolved event
  }

  /** Get session counts per staff (for load balancing) */
  async getStaffSessionCounts(): Promise<
    { staffId: string; openCount: number }[]
  > {
    const counts = await this.prisma.chatSession.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { not: null },
        sessionStatus: {
          in: [
            ChatSessionStatus.OPEN,
            ChatSessionStatus.PENDING,
            ChatSessionStatus.HANDOFF,
          ],
        },
        deletedAt: null,
      },
      _count: { id: true },
    });

    return counts
      .filter((c) => c.assignedToId !== null)
      .map((c) => ({
        staffId: c.assignedToId!,
        openCount: c._count.id,
      }));
  }
}
