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
}
