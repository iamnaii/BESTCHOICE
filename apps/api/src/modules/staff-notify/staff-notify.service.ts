import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { NotificationCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LineOaService } from '../line-oa/line-oa.service';
import type { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { bangkokDateString, bangkokMidnight } from '../../utils/date.util';
import { StaffLineConfigService } from './staff-line-config.service';
import { StaffNotifyRulesService } from './staff-notify-rules.service';
import { catalogItem, type StaffEventKey, type StaffEventPayload, type StaffNotifyRule } from './staff-event-catalog';

export const STAFF_LINE_CHANNEL_KEY = 'line-staff' as const;
const BRANCH_ROLES = new Set(['BRANCH_MANAGER', 'SALES']);
const WARN_INTERVAL_MS = 24 * 3600_000;

export interface StaffRecipient {
  /** null = กลุ่ม LINE จาก Integration Hub */
  userId: string | null;
  lineId: string;
  name: string;
  phone: string | null;
}

export interface StaffNotifyResult {
  skipped?: 'disabled' | 'not_configured' | 'no_recipients';
  recipients: number;
  sent: number;
  deduped: number;
  failed: number;
  quotaSkipped: number;
}

const EMPTY = (): StaffNotifyResult => ({ recipients: 0, sent: 0, deduped: 0, failed: 0, quotaSkipped: 0 });

/** โดเมนแอปพนักงาน — FRONTEND_URL เป็นรายการ CORS คั่น comma ใช้ค่าแรก (สเปก §13.5) */
export function staffAppBaseUrl(): string {
  const first = (process.env.FRONTEND_URL ?? '').split(',')[0]?.trim() ?? '';
  return first.replace(/\/+$/, '');
}

export function formatStaffMessage(p: Pick<StaffEventPayload, 'title' | 'lines' | 'link'>): string {
  const parts = [`📣 BESTCHOICE · ${p.title}`, ...p.lines.filter((l) => l && l.trim().length > 0)];
  const base = staffAppBaseUrl();
  if (p.link) parts.push(`🔗 ${base}${p.link.startsWith('/') || !base ? p.link : `/${p.link}`}`);
  return parts.join('\n');
}

/** ต้นเดือนตามปฏิทินไทย (เที่ยงคืนไทยของวันที่ 1) — ใช้นับโควต้ารายเดือน */
export function bkkMonthStart(now: Date): { start: Date; monthKey: string } {
  const [y, m] = bangkokDateString(now).split('-').map(Number);
  return { start: bangkokMidnight(y, m - 1, 1), monthKey: `${y}-${String(m).padStart(2, '0')}` };
}

/**
 * ท่อเดียวสำหรับแจ้งพนักงานทาง LINE (Staff OA) — สเปก §4
 * ผู้รับตามกติกา (บทบาท/สาขา/ผู้รับเพิ่ม/กลุ่ม) → ตัดซ้ำด้วย NotificationLog → โควต้ารายเดือน → ส่ง (text ผ่าน NotificationsService · Flex ผ่าน LineOaService)
 * ไม่ throw ออกไปหาผู้เรียกเด็ดขาด — งานหลัก (ขาย/อนุมัติ/cron) ต้องไม่ล้มเพราะการแจ้งเตือน
 */
@Injectable()
export class StaffNotifyService {
  private readonly logger = new Logger(StaffNotifyService.name);
  private lastNotConfiguredWarnAt = 0;
  private lastQuotaWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: StaffNotifyRulesService,
    private readonly lineConfig: StaffLineConfigService,
    private readonly notifications: NotificationsService,
    private readonly lineOa: LineOaService,
  ) {}

  async notify(event: StaffEventKey, payload: StaffEventPayload, now: Date = new Date()): Promise<StaffNotifyResult> {
    const result = EMPTY();
    try {
      const rule = await this.rules.getRule(event);
      if (!rule.enabled) return { ...result, skipped: 'disabled' };
      if (!(await this.lineConfig.isConfigured())) {
        this.warnThrottled('notConfigured', now, `[staff-notify] ข้าม ${event} — ไลน์พนักงานยังไม่ได้ตั้งค่า channelToken (Integration Hub › ไลน์พนักงาน)`);
        return { ...result, skipped: 'not_configured' };
      }
      const recipients = await this.resolveRecipients(event, payload, rule);
      result.recipients = recipients.length;
      if (recipients.length === 0) return { ...result, skipped: 'no_recipients' };

      const item = catalogItem(event);
      const relatedId = payload.dedupeKey ? `staff:${event}:${payload.dedupeKey}` : `staff:${event}`;
      const windowMs = item.dedupeWindowHours * 3600_000;
      const { used, cap } = await this.usage(now);
      let budget = Math.max(0, cap - used);

      for (const r of recipients) {
        try {
          if (payload.dedupeKey && windowMs > 0 && (await this.alreadySent(r.lineId, relatedId, new Date(now.getTime() - windowMs)))) {
            result.deduped++;
            continue;
          }
          if (budget <= 0) {
            result.quotaSkipped++;
            continue;
          }
          await this.deliver(r, payload, relatedId, now);
          budget--;
          result.sent++;
        } catch (err) {
          result.failed++;
          Sentry.captureException(err, { tags: { subsystem: 'staff-notify', event }, extra: { recipient: r.lineId } });
          this.logger.error(`[staff-notify] ${event} → ${r.name} ล้ม: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (result.quotaSkipped > 0) {
        this.warnThrottled('quota', now, `[staff-notify] โควต้าข้อความเดือนนี้เต็ม (${used}/${cap}) — ข้าม ${result.quotaSkipped} ผู้รับของ ${event}`);
      }
      return result;
    } catch (err) {
      Sentry.captureException(err, { tags: { subsystem: 'staff-notify', event } });
      this.logger.error(`[staff-notify] ${event} ล้มทั้งรอบ: ${err instanceof Error ? err.message : String(err)}`);
      return { ...result, failed: result.failed + 1 };
    }
  }

  /** ผู้รับ = ผู้ใช้ที่ active ไม่ถูกลบ ไม่ใช่ผู้ใช้ระบบ ผูก LINE แล้ว ตามบทบาท (+ ผู้รับเพิ่ม) · กรองสาขาเมื่อกติกา branchScoped · + กลุ่ม LINE */
  async resolveRecipients(event: StaffEventKey, payload: StaffEventPayload, rule: StaffNotifyRule): Promise<StaffRecipient[]> {
    const extra = (payload.extraRecipientUserIds ?? []).filter(Boolean);
    const base = { isActive: true, deletedAt: null, isSystemUser: false, lineStaffUserId: { not: null } };
    const where = extra.length > 0 ? { ...base, OR: [{ role: { in: rule.roles } }, { id: { in: extra } }] } : { ...base, role: { in: rule.roles } };
    const users = (await this.prisma.user.findMany({
      where: where as never,
      select: { id: true, name: true, role: true, branchId: true, lineStaffUserId: true, phone: true },
    })) as Array<{ id: string; name: string; role: string; branchId: string | null; lineStaffUserId: string | null; phone: string | null }>;
    const out = new Map<string, StaffRecipient>();
    for (const u of users) {
      if (!u.lineStaffUserId) continue;
      const viaRole = (rule.roles as string[]).includes(u.role);
      const viaExtra = extra.includes(u.id);
      if (viaRole && rule.branchScoped && payload.branchId && BRANCH_ROLES.has(u.role) && u.branchId !== payload.branchId && !viaExtra) continue;
      if (!viaRole && !viaExtra) continue;
      if (!out.has(u.lineStaffUserId)) out.set(u.lineStaffUserId, { userId: u.id, lineId: u.lineStaffUserId, name: u.name, phone: u.phone });
    }
    if (rule.includeGroup) {
      for (const lineId of await this.lineConfig.groupTargets()) {
        if (!out.has(lineId)) out.set(lineId, { userId: null, lineId, name: 'กลุ่ม LINE', phone: null });
      }
    }
    void event;
    return [...out.values()];
  }

  /** ข้อความที่ใช้ไปเดือนนี้ (นับ SENT ต่อผู้รับ) เทียบเพดาน */
  async usage(now: Date = new Date()): Promise<{ used: number; cap: number; monthKey: string }> {
    const { start, monthKey } = bkkMonthStart(now);
    const [used, cap] = await Promise.all([
      this.prisma.notificationLog.count({ where: { channelKey: STAFF_LINE_CHANNEL_KEY, status: 'SENT', createdAt: { gte: start } } }),
      this.rules.getMonthlyCap(),
    ]);
    return { used, cap, monthKey };
  }

  /** ข้อความทดสอบถึงผู้ใช้คนหนึ่ง (หน้าผู้ใช้ › "ส่งข้อความทดสอบ") */
  async testToUser(userId: string, byName: string, now: Date = new Date()): Promise<{ ok: true }> {
    const u = await this.loadLinkedUser(userId);
    if (!(await this.lineConfig.isConfigured())) throw new ConflictException('ไลน์พนักงานยังไม่ได้ตั้งค่า — ไปที่ Integration Hub › ไลน์พนักงาน');
    const when = now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    await this.notifications.send({
      channel: 'LINE',
      channelKey: STAFF_LINE_CHANNEL_KEY,
      recipient: u.lineStaffUserId,
      message: `🔧 ทดสอบการเชื่อมต่อ LINE พนักงาน\nถ้าได้รับข้อความนี้ แปลว่า LINE ของ "${u.name}" ผูกถูกคนแล้ว\nส่งโดย ${byName} · ${when}`,
      relatedId: `staff:test:${userId}`,
      category: NotificationCategory.STAFF,
    });
    return { ok: true };
  }

  /** ส่งข้อความตัวอย่างของเหตุการณ์ถึงผู้ใช้คนเดียว (ปุ่ม "ส่งทดสอบถึงฉัน") — ไม่ดูกติกา/ตัดซ้ำ */
  async sendSample(event: StaffEventKey, toUserId: string, now: Date = new Date()): Promise<StaffNotifyResult> {
    const item = catalogItem(event);
    const u = await this.loadLinkedUser(toUserId);
    if (!(await this.lineConfig.isConfigured())) throw new ConflictException('ไลน์พนักงานยังไม่ได้ตั้งค่า — ไปที่ Integration Hub › ไลน์พนักงาน');
    const result = { ...EMPTY(), recipients: 1 };
    try {
      await this.deliver({ userId: u.id, lineId: u.lineStaffUserId, name: u.name, phone: null }, { ...item.sample, smsFallback: false }, `staff:${event}:sample`, now);
      result.sent = 1;
    } catch (err) {
      result.failed = 1;
      Sentry.captureException(err, { tags: { subsystem: 'staff-notify', event: `${event}:sample` } });
    }
    return result;
  }

  private async loadLinkedUser(userId: string): Promise<{ id: string; name: string; lineStaffUserId: string }> {
    const u = (await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, lineStaffUserId: true, isActive: true, deletedAt: true } })) as
      | { id: string; name: string; lineStaffUserId: string | null; isActive: boolean; deletedAt: Date | null }
      | null;
    if (!u || u.deletedAt) throw new BadRequestException('ไม่พบผู้ใช้');
    if (!u.lineStaffUserId) throw new BadRequestException(`"${u.name}" ยังไม่ได้ผูก LINE — สร้างรหัสผูก LINE ที่หน้าผู้ใช้ก่อน`);
    return { id: u.id, name: u.name, lineStaffUserId: u.lineStaffUserId };
  }

  private async alreadySent(lineId: string, relatedId: string, since: Date): Promise<boolean> {
    const hit = await this.prisma.notificationLog.findFirst({
      where: { channelKey: STAFF_LINE_CHANNEL_KEY, recipient: lineId, relatedId, status: 'SENT', createdAt: { gte: since } },
      select: { id: true },
    });
    return !!hit;
  }

  private async deliver(r: StaffRecipient, payload: StaffEventPayload, relatedId: string, now: Date): Promise<void> {
    if (payload.flex) {
      const flex = { type: 'flex', altText: payload.flex.altText, contents: payload.flex.contents } as unknown as FlexMessagePayload;
      try {
        await this.lineOa.sendFlexMessage(r.lineId, flex, STAFF_LINE_CHANNEL_KEY);
        await this.prisma.notificationLog.create({
          data: { channel: 'LINE', channelKey: STAFF_LINE_CHANNEL_KEY, recipient: r.lineId, message: payload.flex.altText, status: 'SENT', relatedId, category: 'STAFF', sentAt: now },
        });
      } catch (err) {
        await this.prisma.notificationLog.create({
          data: { channel: 'LINE', channelKey: STAFF_LINE_CHANNEL_KEY, recipient: r.lineId, message: payload.flex.altText, status: 'FAILED', relatedId, category: 'STAFF', errorMsg: err instanceof Error ? err.message : String(err) },
        }).catch(() => undefined);
        throw err;
      }
      return;
    }
    await this.notifications.send({
      channel: 'LINE',
      channelKey: STAFF_LINE_CHANNEL_KEY,
      recipient: r.lineId,
      message: formatStaffMessage(payload),
      relatedId,
      category: NotificationCategory.STAFF,
      ...(payload.smsFallback && r.phone ? { fallbackPhone: r.phone } : {}),
    });
  }

  private warnThrottled(kind: 'notConfigured' | 'quota', now: Date, message: string) {
    const last = kind === 'notConfigured' ? this.lastNotConfiguredWarnAt : this.lastQuotaWarnAt;
    if (now.getTime() - last < WARN_INTERVAL_MS) return;
    if (kind === 'notConfigured') this.lastNotConfiguredWarnAt = now.getTime();
    else this.lastQuotaWarnAt = now.getTime();
    this.logger.warn(message);
    if (kind === 'quota') Sentry.captureMessage(message, { level: 'warning' });
  }
}
