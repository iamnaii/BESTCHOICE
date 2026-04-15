import { Injectable, Logger, NotFoundException, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatRoomStatus } from '@prisma/client';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../interfaces/chat-gateway.interface';

/**
 * AssignmentService — manages staff ↔ room assignment.
 *
 * Handles assign, transfer (re-assign), and resolve operations.
 * Emits WebSocket events via IChatGateway for real-time updates.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(CHAT_GATEWAY_TOKEN) private gateway?: IChatGateway,
  ) {}

  /** Assign a room to a staff member */
  async assign(roomId: string, staffId: string): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, assignedToId: true },
    });
    if (!room) throw new NotFoundException('ไม่พบ room');

    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        assignedToId: staffId,
        status: ChatRoomStatus.ACTIVE,
      },
    });

    // Log activity
    await this.prisma.staffChatActivity.create({
      data: {
        staffId,
        action: 'assign',
        metadata: { roomId },
      },
    });

    this.logger.log(`Room ${roomId} assigned to staff ${staffId}`);
    this.gateway?.emitRoomUpdate(roomId, { event: 'assigned', roomId, assignedToId: staffId });
    this.gateway?.emitToStaff(staffId, 'chat:assigned', { roomId, assignedToId: staffId });
  }

  /** Transfer a room from one staff to another */
  async transfer(
    roomId: string,
    fromStaffId: string,
    toStaffId: string,
  ): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, assignedToId: true },
    });
    if (!room) throw new NotFoundException('ไม่พบ room');

    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { assignedToId: toStaffId },
    });

    // Log both sides of the transfer
    await this.prisma.staffChatActivity.createMany({
      data: [
        {
          staffId: fromStaffId,
          action: 'transfer_out',
          metadata: { roomId, toStaffId },
        },
        {
          staffId: toStaffId,
          action: 'transfer_in',
          metadata: { roomId, fromStaffId },
        },
      ],
    });

    this.logger.log(
      `Room ${roomId} transferred from ${fromStaffId} to ${toStaffId}`,
    );
    this.gateway?.emitRoomUpdate(roomId, { event: 'transferred', roomId, assignedToId: toStaffId, fromStaffId });
    this.gateway?.emitToStaff(fromStaffId, 'chat:assigned', { roomId, assignedToId: toStaffId, transferred: true });
    this.gateway?.emitToStaff(toStaffId, 'chat:assigned', { roomId, assignedToId: toStaffId, transferred: true });
  }

  /** Resolve/close a room — marks as IDLE */
  async resolve(roomId: string, staffId: string): Promise<void> {
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        status: ChatRoomStatus.IDLE,
        handoffMode: false,
        resolvedAt: new Date(),
      },
    });

    await this.prisma.staffChatActivity.create({
      data: {
        staffId,
        action: 'resolve',
        metadata: { roomId },
      },
    });

    this.logger.log(`Room ${roomId} resolved by staff ${staffId}`);
    this.gateway?.emitRoomUpdate(roomId, { event: 'resolved', roomId, resolvedBy: staffId });
  }

  /**
   * Auto-assign: round-robin to least-busy online staff.
   * Falls back to any staff with OWNER/BRANCH_MANAGER/FINANCE_MANAGER/SALES role
   * if no one is explicitly online.
   */
  async autoAssign(roomId: string): Promise<string | null> {
    // Get staff with open room counts
    const counts = await this.getStaffRoomCounts();
    const countMap = new Map(counts.map((c) => [c.staffId, c.activeCount]));

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

    // Pick the one with fewest active rooms (round-robin / least-busy)
    let bestStaffId = eligibleStaff[0].id;
    let bestCount = countMap.get(bestStaffId) ?? 0;

    for (const staff of eligibleStaff) {
      const count = countMap.get(staff.id) ?? 0;
      if (count < bestCount) {
        bestCount = count;
        bestStaffId = staff.id;
      }
    }

    await this.assign(roomId, bestStaffId);
    return bestStaffId;
  }

  /** Get room counts per staff (for load balancing) */
  async getStaffRoomCounts(): Promise<
    { staffId: string; activeCount: number }[]
  > {
    const counts = await this.prisma.chatRoom.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { not: null },
        status: ChatRoomStatus.ACTIVE,
        deletedAt: null,
      },
      _count: { id: true },
    });

    return counts
      .filter((c) => c.assignedToId !== null)
      .map((c) => ({
        staffId: c.assignedToId!,
        activeCount: c._count.id,
      }));
  }
}
