import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  Optional,
} from '@nestjs/common';
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

  /**
   * Transfer a room from one staff to another.
   *
   * T4-C11 — commission-hijack guard: if the customer in this chat room
   * has already SIGNED a contract (any contract the customer owns that is
   * post-DRAFT / has a signature or has moved into ACTIVE workflow), the
   * sale is effectively booked to the current owner of the chat. Allowing
   * a transfer post-signature lets agent B inherit the chat ownership
   * and claim the commission on agent A's deal via CRM attribution.
   *
   * Reject the transfer. OWNER may override (with audit trail) when a
   * genuine escalation is needed — the override is the loud path so
   * collusion leaves fingerprints.
   */
  async transfer(
    roomId: string,
    fromStaffId: string,
    toStaffId: string,
    actorRole?: string,
  ): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, assignedToId: true, customerId: true },
    });
    if (!room) throw new NotFoundException('ไม่พบ room');

    // T4-C11: block handoff if customer has a signed / active contract
    if (room.customerId) {
      const signedContract = await this.prisma.contract.findFirst({
        where: {
          customerId: room.customerId,
          deletedAt: null,
          OR: [
            // Workflow-level: approved means contract is past signature gate
            { workflowStatus: 'APPROVED' },
            // Status-level: anything past DRAFT is "already signed" territory
            { status: { in: ['ACTIVE', 'COMPLETED', 'OVERDUE', 'DEFAULT'] } },
            // Belt-and-suspenders: any signature row on the contract
            { signatures: { some: { deletedAt: null } } },
          ],
        },
        select: { id: true, contractNumber: true },
      });

      if (signedContract) {
        if (actorRole !== 'OWNER') {
          throw new ForbiddenException(
            `ลูกค้าเซ็นสัญญาแล้ว (${signedContract.contractNumber}) — ห้ามโอนห้องแชทเพื่อป้องกันการแย่งค่าคอมมิชชัน หากจำเป็น ให้ OWNER เป็นผู้โอน`,
          );
        }
        // OWNER override — loud audit log
        await this.prisma.auditLog.create({
          data: {
            userId: fromStaffId,
            action: 'CHAT_HANDOFF_POST_SIGNATURE_OVERRIDE',
            entity: 'chat_room',
            entityId: roomId,
            newValue: {
              contractId: signedContract.id,
              contractNumber: signedContract.contractNumber,
              fromStaffId,
              toStaffId,
              overriddenBy: 'OWNER',
            },
          },
        });
        this.logger.warn(
          `[Handoff] OWNER override — room ${roomId} transferred post-signature (${signedContract.contractNumber})`,
        );
      }
    }

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
