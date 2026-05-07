import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Hourly sweep that flips ACTIVE PartialPaymentLink rows to EXPIRED once they
 * pass their 24h `expiresAt`. Without this the cashier-facing "QR ส่งแล้ว"
 * badge would stay forever — the row stays ACTIVE in DB even when the
 * PaySolutions session has long since timed out.
 *
 * Schedule: every hour at :15 BKK so it doesn't collide with the daily 02:00
 * VAT cron or 02:30 MDM auto-lock.
 */
@Injectable()
export class PartialPaymentExpireCron {
  private readonly logger = new Logger(PartialPaymentExpireCron.name);

  constructor(private prisma: PrismaService) {}

  @Cron('15 * * * *', { timeZone: 'Asia/Bangkok' })
  async expireStaleLinks(): Promise<void> {
    try {
      const result = await this.prisma.partialPaymentLink.updateMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lt: new Date() },
        },
        data: { status: 'EXPIRED' },
      });
      if (result.count > 0) {
        this.logger.log(`Expired ${result.count} stale partial-payment QR links`);
      }
    } catch (error) {
      this.logger.error('Partial-payment expire cron failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'partial-payment-expire' },
      });
    }
  }
}
