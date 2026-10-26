import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LineOaService } from '../line-oa/line-oa.service';
import type { LineWebhookEvent } from '../line-oa/dto/webhook-event.dto';
import { STAFF_ROLE_LABELS, type StaffRole } from './staff-event-catalog';

export const STAFF_LINE_LINK_CODE_TTL_MS = 15 * 60_000;
const CHANNEL = 'line-staff' as const;
const CODE_RE = /^\d{6}$/;

/**
 * ผูก LINE ของพนักงานกับ Staff OA ด้วยรหัส 6 หลัก (สเปก §13.1)
 * หน้าผู้ใช้ออกรหัส (หมดอายุ 15 นาที ใช้ครั้งเดียว) → พนักงานเพิ่มเพื่อน Staff OA แล้วพิมพ์รหัสในแชท → webhook จับ userId มาผูก
 */
@Injectable()
export class StaffLineLinkService {
  private readonly logger = new Logger(StaffLineLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lineOa: LineOaService,
    private readonly audit: AuditService,
  ) {}

  async issueCode(userId: string, actorId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: Date }> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + STAFF_LINE_LINK_CODE_TTL_MS);
    await this.prisma.user.update({ where: { id: userId }, data: { lineLinkCode: code, lineLinkCodeExpiresAt: expiresAt } });
    await this.audit.log({ action: 'STAFF_LINE_LINK_CODE_ISSUED', entity: 'user', entityId: userId, userId: actorId, newValue: { expiresAt } });
    return { code, expiresAt };
  }

  async unlink(userId: string, actorId: string): Promise<{ ok: true }> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, lineStaffUserId: true } });
    if (!u?.lineStaffUserId) return { ok: true };
    await this.prisma.user.update({ where: { id: userId }, data: { lineStaffUserId: null, lineLinkCode: null, lineLinkCodeExpiresAt: null } });
    await this.audit.log({ action: 'STAFF_LINE_UNLINKED', entity: 'user', entityId: userId, userId: actorId, oldValue: { lineStaffUserId: u.lineStaffUserId } });
    return { ok: true };
  }

  /** เหตุการณ์จาก webhook ของ Staff OA — ไม่ throw (LINE ต้องได้ 200 เสมอ) */
  async handleWebhookEvents(events: LineWebhookEvent[], now: Date = new Date()): Promise<void> {
    for (const event of events ?? []) {
      try {
        await this.handleOne(event, now);
      } catch (err) {
        Sentry.captureException(err, { tags: { subsystem: 'staff-notify', stage: 'link-webhook' } });
        this.logger.error(`[staff-line-link] event ${event?.type} ล้ม: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async handleOne(event: LineWebhookEvent, now: Date): Promise<void> {
    const lineUserId = event.source?.userId;
    if (!lineUserId) return;
    if (event.type === 'follow') {
      await this.reply(event.replyToken, 'สวัสดีค่ะ นี่คือไลน์พนักงาน BESTCHOICE\nพิมพ์รหัสผูกบัญชี 6 หลักที่ได้จากหน้าผู้ใช้ในระบบ เพื่อรับแจ้งเตือนภายใน');
      return;
    }
    if (event.type !== 'message' || event.message?.type !== 'text') return;
    const text = (event.message.text ?? '').trim();
    if (!CODE_RE.test(text)) return; // ข้อความอื่น — เงียบ

    const user = (await this.prisma.user.findFirst({
      where: { lineLinkCode: text, lineLinkCodeExpiresAt: { gt: now }, deletedAt: null, isActive: true },
      select: { id: true, name: true, role: true, lineLinkCodeExpiresAt: true },
    })) as { id: string; name: string; role: string; lineLinkCodeExpiresAt: Date | null } | null;
    if (!user) {
      await this.reply(event.replyToken, 'รหัสไม่ถูกต้องหรือหมดอายุ — ขอรหัสใหม่จากหน้าผู้ใช้ในระบบแล้วพิมพ์อีกครั้ง');
      return;
    }
    // LINE นี้เคยผูกคนอื่นอยู่ → ย้ายมาคนนี้ (unique) และบันทึกไว้
    const moved = await this.prisma.user.updateMany({ where: { lineStaffUserId: lineUserId, id: { not: user.id } }, data: { lineStaffUserId: null } });
    await this.prisma.user.update({ where: { id: user.id }, data: { lineStaffUserId: lineUserId, lineLinkCode: null, lineLinkCodeExpiresAt: null } });
    await this.audit.log({
      action: 'STAFF_LINE_LINKED',
      entity: 'user',
      entityId: user.id,
      userId: user.id,
      newValue: { lineStaffUserId: lineUserId, movedFromOtherUser: moved.count > 0 },
    });
    const roleLabel = STAFF_ROLE_LABELS[user.role as StaffRole] ?? user.role;
    await this.reply(event.replyToken, `ผูกสำเร็จ: ${user.name} (${roleLabel})\nจากนี้จะได้รับแจ้งเตือนภายในตามบทบาทของคุณทางแชทนี้`);
  }

  private async reply(replyToken: string | undefined, text: string): Promise<void> {
    if (!replyToken) return;
    try {
      await this.lineOa.replyMessage(replyToken, [{ type: 'text', text }], CHANNEL);
    } catch (err) {
      this.logger.warn(`[staff-line-link] reply ล้ม: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
