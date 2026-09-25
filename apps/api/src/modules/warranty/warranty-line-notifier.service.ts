// PR 3 Task 5 — ส่งไลน์ "ประกันใกล้หมด 7 วัน" ให้ลูกค้า SHOP-side (lineIdShop) ต่อ item หนึ่ง
// เครื่อง/หนึ่งชนิดประกัน (`ExpiringWarrantyItem` จาก `WarrantyService.getExpiringWarranties`).
//
// dedup ด้วย `NotificationLog.relatedId` (`warranty:<source>:<sourceId>:<type>`) — ตรวจก่อนส่งจริง
// ทุกครั้งเพื่อกันส่งซ้ำเมื่อ cron รันมากกว่าหนึ่งครั้งต่อวัน (ดู Ruling PF-5: ห้ามใช้
// `NotificationLog.subject` เพราะมันเก็บ subject/name ของแม่แบบ ไม่ใช่ event type).
//
// ห้าม throw ไม่ว่ากรณีใด — `WarrantyCron` วน loop ทีละ item และต้องไม่ให้เครื่องเดียวพังทั้งคิว.
// แม่แบบ WARRANTY_EXPIRING_7D ปิดอยู่ (`is_active=false`) จนกว่าเจ้าของจะเคาะข้อความ (Task 1) —
// วันนี้ทุกการส่งจะได้ `BLOCKED`/`TEMPLATE_INACTIVE` จาก `NotificationsService` โดยตั้งใจ.

import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import {
  WARRANTY_EXPIRING_EVENT_TYPE,
  buildLiffLine,
  thaiShortYearDate,
} from '../after-sales/utils/after-sales-line-copy.util';
import type { ExpiringWarrantyItem } from './warranty.service';

/** สถานะจาก `sendFromTemplate` ที่นับว่า "อยู่ระหว่างส่ง/ส่งแล้ว" — ตัวเดียวกับ probe dedup */
const IN_FLIGHT_STATUSES = ['SENT', 'PENDING', 'RETRY_PENDING', 'DELAYED'] as const;

export type WarrantyNotifyResult = 'SENT' | 'NO_LINK' | 'DUP' | 'BLOCKED' | 'FAILED';

@Injectable()
export class WarrantyLineNotifierService {
  private readonly logger = new Logger(WarrantyLineNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly integrationConfig: IntegrationConfigService,
  ) {}

  async notifyExpiring(item: ExpiringWarrantyItem): Promise<WarrantyNotifyResult> {
    // PII: lineIdShop อยู่แค่ที่นี่ — ห้าม log ตัวแปรนี้หรือใส่มันลง data/relatedId
    if (!item.lineIdShop) return 'NO_LINK';

    const relatedId = `warranty:${item.source}:${item.sourceId}:${item.type}`;

    try {
      const dup = await this.prisma.notificationLog.findFirst({
        where: { relatedId, status: { in: [...IN_FLIGHT_STATUSES] } },
        select: { id: true },
      });
      if (dup) return 'DUP';

      const liffId = await this.integrationConfig.getValue('line-shop', 'liffId').catch(() => null);

      const data: Record<string, string> = {
        warrantyType: item.type === 'shop' ? 'ร้าน' : 'ศูนย์',
        deviceName: item.deviceName,
        daysRemaining: String(item.daysRemaining),
        expireDate: thaiShortYearDate(item.expireDate) ?? '',
        liffLine: buildLiffLine(liffId ?? null, 'ประกันของฉัน'),
      };

      const res = await this.notifications.sendFromTemplate(
        WARRANTY_EXPIRING_EVENT_TYPE,
        data,
        item.lineIdShop,
        { customerId: item.customerId, relatedId },
      );

      if ((IN_FLIGHT_STATUSES as readonly string[]).includes(res.status)) return 'SENT';

      if (res.status === 'FAILED') {
        // sendFromTemplate can RESOLVE (not throw) with status:'FAILED' once its internal
        // retry loop exhausts (LINE push failed 3x, stale/blocked recipient — see
        // notification-dispatch.service.ts). No other layer alerts on this path, so it must
        // be surfaced here — never silently folded into BLOCKED (no PII in the message/extra).
        Sentry.captureMessage('warranty line: dispatcher returned FAILED', {
          level: 'warning',
          tags: { subsystem: 'warranty-line' },
          extra: { relatedId, blockReason: res.blockReason ?? null },
        });
        return 'FAILED';
      }

      // BLOCKED (เช่น TEMPLATE_INACTIVE) หรือสถานะอื่นที่ dispatcher เพิ่งเพิ่ม — ไม่ใช่ความผิดพลาด
      // ของระบบ ไม่ยิง Sentry (ตรงตามสัญญา: แม่แบบปิดคือของที่ตั้งใจปิดไว้)
      return 'BLOCKED';
    } catch (err) {
      this.logger.warn(
        `[warranty-line] ส่งไม่สำเร็จ ${relatedId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, { tags: { subsystem: 'warranty-line' } });
      return 'FAILED';
    }
  }
}
