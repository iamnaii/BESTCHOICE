import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { bangkokDateString } from '../../../utils/date.util';
import { StaffNotifyService } from '../../staff-notify/staff-notify.service';
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
 * StaffNotificationService — ประกอบข้อความของแชทไฟแนนซ์แล้วส่งผ่านท่อกลาง StaffNotifyService (ก้อน 7 A16)
 * ผู้รับ/สวิตช์/ตัดซ้ำ/โควต้า อยู่ที่ท่อกลาง (หน้า แจ้งเตือน › แจ้งพนักงาน) — ที่นี่แค่ "เกิดอะไร"
 *
 * Trigger points:
 *   1. Handoff (จาก HandoffService) — ลูกค้ารอคุย
 *   2. Slip review needed (จาก SlipProcessingService) — ยอดไม่ตรง / ผิดบัญชี
 *   3. Slip SLA breached (จาก slip-sla cron) — สรุปวันละครั้ง
 */
@Injectable()
export class StaffNotificationService {
  private readonly logger = new Logger(StaffNotificationService.name);

  constructor(
    private prisma: PrismaService,
    private staffNotify: StaffNotifyService,
  ) {}

  // ─── Notification: Handoff ───────────────────────────────

  async notifyHandoff(params: {
    roomId: string;
    reason: string;
    priority: HandoffPriority;
    summary: string;
  }): Promise<void> {
    try {
      // ดึง context: customer + 5 ข้อความล่าสุด
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: params.roomId },
        include: {
          customer: { select: { name: true, phone: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 5 },
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
          const role = m.role === 'CUSTOMER' ? '👤' : m.role === 'BOT' ? '🤖' : m.role === 'STAFF' ? '👨‍💼' : '⚙️';
          const time = m.createdAt.toTimeString().slice(0, 5);
          const text = (m.text ?? '').slice(0, 80);
          return `${role} [${time}] ${text}`;
        });
      await this.staffNotify.notify('chat.handoff', {
        title: `${PRIORITY_EMOJI[params.priority]} ลูกค้ารอคุย [${PRIORITY_LABEL[params.priority]}]`,
        lines: [`👤 ${customerName}`, `📞 ${phone}`, `📌 เรื่อง: ${params.reason}`, `📝 ${params.summary}`, '📜 บทสนทนาล่าสุด:', ...recentMessages],
        link: `/inbox/${params.roomId}`,
        dedupeKey: params.roomId,
      });
    } catch (err) {
      this.logger.error(`[StaffNotify] handoff failed: ${err instanceof Error ? err.message : err}`);
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
    try {
      const reasonText = {
        amount_mismatch: '💰 ยอดไม่ตรง',
        wrong_account: '⚠️ โอนผิดบัญชี',
        unmatched: '❓ จับคู่งวดไม่ได้',
      }[params.reason];
      const phone = params.customerPhone ? maskPhone(params.customerPhone) : '-';
      const lines = [`👤 ${params.customerName}`, `📞 ${phone}`, `📋 สัญญา: ${params.contractNumber}`, `💰 ยอดในสลิป: ${params.slipAmount.toLocaleString()} บาท`];
      if (params.expectedAmount != null) lines.push(`💰 ยอดงวดนี้: ${params.expectedAmount.toLocaleString()} บาท`);
      lines.push(reasonText);
      await this.staffNotify.notify('chat.slip_review', { title: '🧾 สลิปรอตรวจสอบ', lines, link: '/slip-review', dedupeKey: params.evidenceId });
    } catch (err) {
      this.logger.error(`[StaffNotify] slip review failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Notification: Slip SLA breached ─────────────────────

  /**
   * สลิปค้าง PENDING_REVIEW เกิน SLA — cron รันทุกชั่วโมง แต่ข้อความรวมส่งวันละครั้ง (dedupe ตามวันที่ไทย)
   */
  async notifySlipSlaBreached(params: { count: number; oldestAgeHours: number }, now: Date = new Date()): Promise<void> {
    if (params.count === 0) return;
    try {
      await this.staffNotify.notify('chat.slip_sla', {
        title: '⏰ สลิปรอตรวจสอบเกิน SLA',
        lines: [`📋 จำนวน: ${params.count} ใบ`, `⏳ ใบเก่าสุดรอมาแล้ว ${params.oldestAgeHours.toFixed(1)} ชั่วโมง`],
        link: '/slip-review',
        dedupeKey: `sla:${bangkokDateString(now)}`,
      });
    } catch (err) {
      this.logger.error(`[StaffNotify] slip SLA failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
