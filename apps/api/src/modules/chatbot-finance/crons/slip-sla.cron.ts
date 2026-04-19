import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { StaffNotificationService } from '../services/staff-notification.service';

/**
 * Slip SLA cron — alert staff when PaymentEvidence sits in PENDING_REVIEW past
 * the SLA window. Runs hourly. Pairs with auto-approve logic in
 * SlipProcessingService: high-confidence matches skip review entirely, so the
 * queue that hits this cron is the tail that actually needs human eyes.
 *
 * Window logic: alert for evidences created between (now - 24h) and (now - 4h).
 * The lower bound avoids alerting forever on ancient stuck slips — if nobody
 * touched it in 24h, the team either has a bigger problem or the slip is
 * already known. Sentry dedups by message fingerprint anyway.
 */
@Injectable()
export class SlipSlaCron {
  private readonly logger = new Logger(SlipSlaCron.name);
  static readonly SLA_HOURS = 4;
  static readonly ALERT_WINDOW_HOURS = 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly staffNotify: StaffNotificationService,
  ) {}

  @Cron('0 * * * *', { timeZone: 'Asia/Bangkok' })
  async scanOverdueEvidences(): Promise<{ count: number; oldestAgeHours: number }> {
    try {
      const now = Date.now();
      const slaCutoff = new Date(now - SlipSlaCron.SLA_HOURS * 60 * 60 * 1000);
      const windowFloor = new Date(now - SlipSlaCron.ALERT_WINDOW_HOURS * 60 * 60 * 1000);

      const stuck = await this.prisma.paymentEvidence.findMany({
        where: {
          deletedAt: null,
          status: 'PENDING_REVIEW',
          createdAt: { lte: slaCutoff, gte: windowFloor },
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      if (stuck.length === 0) {
        return { count: 0, oldestAgeHours: 0 };
      }

      const oldestAgeHours = (now - stuck[0].createdAt.getTime()) / (60 * 60 * 1000);

      this.logger.warn(
        `Slip SLA breach: ${stuck.length} evidence(s) pending > ${SlipSlaCron.SLA_HOURS}h, oldest ${oldestAgeHours.toFixed(1)}h`,
      );

      Sentry.captureMessage(
        `Slip review SLA breached: ${stuck.length} evidence(s) pending > ${SlipSlaCron.SLA_HOURS}h`,
        {
          level: 'warning',
          tags: { kind: 'cron-job', cron: 'slip-sla' },
          extra: { count: stuck.length, oldestAgeHours, evidenceIds: stuck.map((e) => e.id) },
        },
      );

      await this.staffNotify.notifySlipSlaBreached({
        count: stuck.length,
        oldestAgeHours,
      });

      return { count: stuck.length, oldestAgeHours };
    } catch (err) {
      this.logger.error(`Slip SLA cron failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'slip-sla' } });
      return { count: 0, oldestAgeHours: 0 };
    }
  }
}
