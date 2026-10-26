import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StaffNotifyService } from '../staff-notify/staff-notify.service';

/**
 * Sends an internal LINE alert to all OWNER users who have lineId set.
 * Used by collections crons to surface pending-approval counts so OWNER
 * doesn't have to poll the approval tab.
 *
 * Silent no-op if no OWNER has lineId — logged but not an error. Individual
 * send failures are swallowed at the caller level (Sentry capture there).
 */
@Injectable()
export class OwnerAlertHelper {
  private readonly logger = new Logger(OwnerAlertHelper.name);
  /** คง prisma/notifications ไว้ใน ctor เพื่อไม่กระทบ DI/spec ของผู้เรียก (ไม่ได้ใช้แล้ว) */
  protected readonly legacyDeps = () => [this.prisma, this.notifications];

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    @Optional() private readonly staffNotify?: StaffNotifyService,
  ) {}

  /**
   * ก้อน 7 A16 — ผ่านท่อกลาง (เหตุการณ์ overdue.owner_alert ถึง OWNER · LINE ล้ม → SMS ไปเบอร์ผู้รับ)
   * ไม่ตัดซ้ำ: ผู้เรียกใช้ relatedId คงที่ซ้ำทุกรอบ และตัวเลขในข้อความเปลี่ยนทุกวัน
   */
  async sendToAllOwners(
    message: string,
    relatedId?: string,
  ): Promise<{ sent: number; failed: number }> {
    void relatedId;
    if (!this.staffNotify) {
      this.logger.warn('StaffNotifyService unavailable — owner alert skipped');
      return { sent: 0, failed: 0 };
    }
    const [title, ...rest] = message.split('\n');
    const res = await this.staffNotify.notify('overdue.owner_alert', {
      title,
      lines: rest.filter((l) => l.trim().length > 0),
      link: '/overdue',
      smsFallback: true,
    });
    return { sent: res.sent, failed: res.failed };
  }
}
