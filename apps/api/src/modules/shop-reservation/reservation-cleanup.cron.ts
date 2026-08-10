import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { ShopReservationService } from './shop-reservation.service';

/**
 * prod พบ log "Preempt-notify cron failed: " ที่ข้อความว่างเปล่า (err ไม่ใช่ Error
 * หรือ message ว่าง เช่น Prisma connection error บางชนิด) — ประกอบเองให้เห็น
 * name/code เสมอ เพื่อวินิจฉัยจาก Cloud Run log ได้โดยไม่ต้องเปิด Sentry
 */
function describeError(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string };
  const parts = [e?.name, e?.code, e?.message].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : String(err);
}

@Injectable()
export class ReservationCleanupCron {
  private readonly logger = new Logger(ReservationCleanupCron.name);

  constructor(private reservationService: ShopReservationService) {}

  @Cron('*/5 * * * *', { timeZone: 'Asia/Bangkok' }) // every 5 min
  async expireOldReservations(): Promise<void> {
    try {
      const count = await this.reservationService.expireOldReservations();
      if (count > 0) this.logger.log(`Expired ${count} reservations`);
    } catch (err) {
      this.logger.error(`Cron failed: ${describeError(err)}`);
      Sentry.captureException(err);
    }
  }

  /**
   * B5: แจ้งลูกค้าที่ hold โดนตัดหน้า — ทุก 1 นาที (ลูกค้าที่กำลังจ่ายเงินอยู่รอ 5 นาทีไม่ไหว)
   * งานเบามาก: query มี index `(status, preempt_notified_at)` และปกติได้ 0 แถว
   */
  @Cron('* * * * *', { timeZone: 'Asia/Bangkok' })
  async notifyPreemptedHolds(): Promise<void> {
    try {
      const sent = await this.reservationService.notifyPreemptedHolds();
      if (sent > 0) this.logger.log(`Notified ${sent} preempted holds`);
    } catch (err) {
      this.logger.error(`Preempt-notify cron failed: ${describeError(err)}`);
      Sentry.captureException(err);
    }
  }
}
