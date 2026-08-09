import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { ShopReservationService } from './shop-reservation.service';

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
      this.logger.error(`Cron failed: ${(err as Error).message}`);
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
      this.logger.error(`Preempt-notify cron failed: ${(err as Error).message}`);
      Sentry.captureException(err);
    }
  }
}
