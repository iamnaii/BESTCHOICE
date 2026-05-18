import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { BookingsService } from './bookings.service';

/**
 * P2-SP4 — Daily cron at 00:30 BKK that flips PAID bookings whose `expireDate`
 * has passed into EXPIRED status (customer forfeits the deposit, per owner's
 * configured policy: cancel-after-expire = 0% refund).
 *
 * Time window chosen to avoid contention with the 00:01 InstallmentAccrual
 * cron and the 02:00 VAT-60day cron. Sentry capture mirrors the other
 * cron jobs hardened in ultraplan v2 (PR #432).
 */
@Injectable()
export class BookingExpireCron {
  private readonly logger = new Logger(BookingExpireCron.name);

  constructor(private readonly bookings: BookingsService) {}

  @Cron('30 0 * * *', { timeZone: 'Asia/Bangkok' })
  async expireOverdueBookings(): Promise<void> {
    try {
      const flipped = await this.bookings.autoExpire();
      if (flipped > 0) {
        this.logger.log(`Auto-expired ${flipped} booking(s) past expireDate`);
      }
    } catch (err) {
      this.logger.error(
        `BookingExpireCron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err);
    }
  }
}
