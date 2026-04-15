import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineStaffClientService } from './line-staff-client.service';
import { HandoffPriority } from './handoff.service';
import { maskPhone } from '../utils/mask-phone';

const PRIORITY_EMOJI: Record<HandoffPriority, string> = {
  low: '📩',
  normal: '🔔',
  high: '⚠️',
  critical: '🚨',
};

const PRIORITY_LABEL: Record<HandoffPriority, string> = {
  low: 'LOW',
  normal: 'NORMAL',
  high: 'HIGH',
  critical: 'CRITICAL',
};

/**
 * StaffNotificationService — สร้างข้อความ notification + ส่งผ่าน LineStaffClient
 *
 * Trigger points:
 *   1. Handoff (จาก HandoffService) — ลูกค้ารอคุย
 *   2. Slip review needed (จาก SlipProcessingService) — ยอดไม่ตรง / ผิดบัญชี
 *
 * Phase E: ต่อยอดเป็น Flex Message + button actions (เปิดแชท / รับเรื่อง)
 */
@Injectable()
export class StaffNotificationService {
  private readonly logger = new Logger(StaffNotificationService.name);

  constructor(
    private prisma: PrismaService,
    private lineStaff: LineStaffClientService,
  ) {}

  // ─── Notification: Handoff ───────────────────────────────

  async notifyHandoff(params: {
    roomId: string;
    reason: string;
    priority: HandoffPriority;
    summary: string;
  }): Promise<void> {
    if (!this.lineStaff.isConfigured) return;

    // ดึง context: customer + 5 ข้อความล่าสุด
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: params.roomId },
      include: {
        customer: { select: { name: true, phone: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!room) {
      this.logger.warn(`[StaffNotify] room ${params.roomId} not found`);
      return;
    }

    const customerName = room.customer?.name ?? '(ลูกค้าใหม่)';
    const phone = room.customer?.phone ? maskPhone(room.customer.phone) : '-';

    const recentMessages = room.messages
      .reverse()
      .map((m) => {
        const role =
          m.role === 'CUSTOMER'
            ? '👤'
            : m.role === 'BOT'
              ? '🤖'
              : m.role === 'STAFF'
                ? '👨‍💼'
                : '⚙️';
        const time = m.createdAt.toTimeString().slice(0, 5);
        const text = (m.text ?? '').slice(0, 80);
        return `${role} [${time}] ${text}`;
      })
      .join('\n');

    const text =
      `${PRIORITY_EMOJI[params.priority]} ลูกค้ารอคุย [${PRIORITY_LABEL[params.priority]}]\n\n` +
      `👤 ${customerName}\n` +
      `📞 ${phone}\n` +
      `📌 เรื่อง: ${params.reason}\n` +
      `📝 ${params.summary}\n\n` +
      `📜 บทสนทนาล่าสุด:\n${recentMessages}\n\n` +
      `🔗 Room ID: ${params.roomId.slice(0, 8)}...`;

    try {
      await this.lineStaff.broadcastText(text);
    } catch (err) {
      this.logger.error(
        `[StaffNotify] handoff broadcast failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ─── Notification: Slip review needed ────────────────────

  async notifySlipReview(params: {
    customerName: string;
    customerPhone?: string;
    contractNumber: string;
    slipAmount: number;
    expectedAmount?: number;
    reason: 'amount_mismatch' | 'wrong_account' | 'unmatched';
    evidenceId: string;
  }): Promise<void> {
    if (!this.lineStaff.isConfigured) return;

    const reasonText = {
      amount_mismatch: '💰 ยอดไม่ตรง',
      wrong_account: '⚠️ โอนผิดบัญชี',
      unmatched: '❓ จับคู่งวดไม่ได้',
    }[params.reason];

    const phone = params.customerPhone ? maskPhone(params.customerPhone) : '-';

    const text =
      `🧾 สลิปรอตรวจสอบ\n\n` +
      `👤 ${params.customerName}\n` +
      `📞 ${phone}\n` +
      `📋 สัญญา: ${params.contractNumber}\n` +
      `💰 ยอดในสลิป: ${params.slipAmount.toLocaleString()} บาท\n` +
      (params.expectedAmount != null
        ? `💰 ยอดงวดนี้: ${params.expectedAmount.toLocaleString()} บาท\n`
        : '') +
      `\n${reasonText}\n\n` +
      `🔗 Evidence: ${params.evidenceId.slice(0, 8)}...`;

    try {
      await this.lineStaff.broadcastText(text);
    } catch (err) {
      this.logger.error(
        `[StaffNotify] slip review broadcast failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ─── helpers ─────────────────────────────────────────────

}
