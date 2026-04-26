import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoAssignService } from './auto-assign.service';

@Injectable()
export class CollectionsSessionCron {
  private readonly logger = new Logger(CollectionsSessionCron.name);

  constructor(
    private autoAssign: AutoAssignService,
    private prisma: PrismaService,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'Asia/Bangkok' })
  async runAutoAssign(): Promise<void> {
    this.logger.log('Starting collections auto-assign');
    try {
      const result = await this.autoAssign.runForDate(new Date());
      this.logger.log(
        `Auto-assign done: assigned=${result.assigned} pool=${result.pool} escalation=${result.escalation}`,
      );
    } catch (error) {
      this.logger.error('Collections auto-assign failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'collections-auto-assign' },
      });
    }
  }

  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async runAutoLock(): Promise<void> {
    this.logger.log('Starting collections auto-lock');
    try {
      const today = startOfDay(new Date());
      const result = await this.prisma.dailyAssignment.updateMany({
        where: { date: today, lockedAt: null, status: 'PENDING' },
        data: { lockedAt: new Date() },
      });
      this.logger.log(`Auto-lock: ${result.count} assignments locked`);
    } catch (error) {
      this.logger.error('Collections auto-lock failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'collections-auto-lock' },
      });
    }
  }

  @Cron('*/15 9-20 * * *', { timeZone: 'Asia/Bangkok' })
  async runPoolExpiry(): Promise<void> {
    try {
      const now = new Date();
      const result = await this.prisma.dailyAssignment.updateMany({
        where: {
          source: 'SELF_CLAIMED',
          status: 'PENDING',
          lockExpiresAt: { lte: now },
        },
        data: { collectorId: null, lockedAt: null, lockExpiresAt: null },
      });
      if (result.count > 0) {
        this.logger.log(`Pool-expiry: released ${result.count} self-claimed contracts`);
      }
    } catch (error) {
      this.logger.error('Pool-expiry cron failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'collections-pool-expiry' },
      });
    }
  }

  @Cron('0 18 * * *', { timeZone: 'Asia/Bangkok' })
  async runDailySummary(): Promise<void> {
    this.logger.log('Computing collections daily summary');
    try {
      const today = startOfDay(new Date());
      const summaries = await this.prisma.dailyAssignment.groupBy({
        by: ['collectorId', 'status'],
        where: { date: today, collectorId: { not: null } },
        _count: true,
      });
      this.logger.log(`Daily summary computed: ${summaries.length} (collector,status) buckets`);
    } catch (error) {
      this.logger.error('Daily summary failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'collections-summary' },
      });
    }
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
