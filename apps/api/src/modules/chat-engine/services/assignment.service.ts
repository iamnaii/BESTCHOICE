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

  /**
   * Auto-assign: round-robin to least-busy online staff.
   * Falls back to any staff with OWNER/BRANCH_MANAGER/FINANCE_MANAGER/SALES role
   * if no one is explicitly online.
   */
  async autoAssign(sessionId: string): Promise<string | null> {
    // Get staff with open session counts
    const counts = await this.getStaffSessionCounts();
    const countMap = new Map(counts.map((c) => [c.staffId, c.openCount]));

    // Get all eligible staff (active, not deleted)
    const eligibleStaff = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { in: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'] },
      },
      select: { id: true },
    });

    if (eligibleStaff.length === 0) return null;

    // Pick the one with fewest open sessions (round-robin / least-busy)
    let bestStaffId = eligibleStaff[0].id;
    let bestCount = countMap.get(bestStaffId) ?? 0;

    for (const staff of eligibleStaff) {
      const count = countMap.get(staff.id) ?? 0;
      if (count < bestCount) {
        bestCount = count;
        bestStaffId = staff.id;
      }
    }

    await this.assign(sessionId, bestStaffId);
    return bestStaffId;
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
