import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationTransportService } from './notification-transport.service';

/**
 * Read-side notification analytics — log queries + log/compliance stats for
 * the NotificationsPage dashboard. Reuses the transport's SMS credit check for
 * the informational credit balance on `getLogStats`.
 *
 * Plain class (not @Injectable) — constructed internally by NotificationsService.
 */
export class NotificationStatsService {
  constructor(
    private prisma: PrismaService,
    private transport: NotificationTransportService,
  ) {}

  async findLogs(filters: { channel?: string; status?: string; relatedId?: string; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (filters.channel) where.channel = filters.channel;
    if (filters.status) where.status = filters.status;
    if (filters.relatedId) where.relatedId = filters.relatedId;

    return this.prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit || 50, 100),
    });
  }

  async getLogStats() {
    const groups = await this.prisma.notificationLog.groupBy({
      by: ['channel', 'status'],
      where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      _count: { _all: true },
    });

    const empty = () => ({ total: 0, sent: 0, failed: 0, pending: 0 });
    const result = {
      line: empty(),
      sms: { ...empty(), creditRemaining: 0 },
      in_app: empty(),
    };

    for (const g of groups) {
      const key = (g.channel === 'IN_APP' ? 'in_app' : g.channel.toLowerCase()) as
        | 'line'
        | 'sms'
        | 'in_app';
      const bucket = result[key];
      if (!bucket) continue;
      const count = g._count._all;
      bucket.total += count;
      if (g.status === 'SENT') bucket.sent += count;
      else if (g.status === 'FAILED') bucket.failed += count;
      else bucket.pending += count;
    }

    // Add SMS credit (informational)
    try {
      const credit = await this.transport.checkSmsCredit();
      result.sms.creditRemaining = credit.credit ?? 0;
    } catch {
      // ignore — credit check is informational
    }

    return result;
  }

  /**
   * Compliance block-rate stats — last N days, grouped by blockReason.
   * Used by NotificationsPage dashboard to surface compliance enforcement
   * activity (OUTSIDE_HOURS / FREQUENCY_CAP / NO_CONSENT / HOLIDAY_BLOCK).
   */
  async getComplianceStats(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const blocks = await this.prisma.notificationLog.groupBy({
      by: ['blockReason'],
      where: {
        blockReason: { not: null },
        createdAt: { gte: since },
        deletedAt: null,
      },
      _count: { _all: true },
    });

    const result: Record<string, number> = {
      OUTSIDE_HOURS: 0,
      FREQUENCY_CAP: 0,
      NO_CONSENT: 0,
      HOLIDAY_BLOCK: 0,
    };
    for (const b of blocks) {
      if (b.blockReason && result[b.blockReason] !== undefined) {
        result[b.blockReason] = b._count._all;
      }
    }
    return result;
  }
}
