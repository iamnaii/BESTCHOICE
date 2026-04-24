import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AnalyticsResult {
  range: '30d' | '90d';
  weeklyCollectionRate: Array<{ weekStart: string; paidCount: number; dueCount: number; rate: number }>;
  promiseKeptTrend: Array<{ weekStart: string; kept: number; broken: number }>;
  dunningActionVolume: Array<{ date: string; sent: number; failed: number }>;
  letterDispatchByType: Array<{ type: string; month: string; count: number }>;
  mdmLockVolume: Array<{ date: string; proposed: number; approved: number }>;
}

type WeeklyCollectionRow = { week_start: Date; paid_count: bigint; due_count: bigint };
type PromiseKeptRow = { week_start: Date; kept: bigint; broken: bigint };
type DunningVolumeRow = { day: Date; sent: bigint; failed: bigint };
type LetterDispatchRow = { letter_type: string; month: Date; cnt: bigint };
type MdmVolumeRow = { day: Date; proposed: bigint; approved: bigint };

@Injectable()
export class OverdueAnalyticsService {
  private readonly logger = new Logger(OverdueAnalyticsService.name);
  // 5-minute in-memory cache per range
  private cache = new Map<string, { value: AnalyticsResult; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaService) {}

  async getAnalytics(params: { range: '30d' | '90d' }): Promise<AnalyticsResult> {
    const cacheKey = params.range;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = await this.compute(params.range);
    this.cache.set(cacheKey, { value, expiresAt: now + this.CACHE_TTL_MS });
    return value;
  }

  private async compute(range: '30d' | '90d'): Promise<AnalyticsResult> {
    const days = range === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      weeklyCollectionRate,
      promiseKeptTrend,
      dunningActionVolume,
      letterDispatchByType,
      mdmLockVolume,
    ] = await Promise.all([
      this.weeklyCollectionRate(since),
      this.promiseKeptTrend(since),
      this.dunningActionVolume(since),
      this.letterDispatchByType(since),
      this.mdmLockVolume(since),
    ]);

    return {
      range,
      weeklyCollectionRate,
      promiseKeptTrend,
      dunningActionVolume,
      letterDispatchByType,
      mdmLockVolume,
    };
  }

  /**
   * Count paid payments vs due payments bucketed by ISO week start.
   * A payment is "due" if its dueDate falls in the week;
   * "paid" if its paidDate falls in the week.
   */
  private async weeklyCollectionRate(
    since: Date,
  ): Promise<AnalyticsResult['weeklyCollectionRate']> {
    try {
      const rows = await this.prisma.$queryRaw<WeeklyCollectionRow[]>`
        SELECT
          date_trunc('week', p.paid_date)::date  AS week_start,
          COUNT(*) FILTER (WHERE p.status = 'PAID') AS paid_count,
          COUNT(*) AS due_count
        FROM payments p
        WHERE p.deleted_at IS NULL
          AND p.paid_date >= ${since}
        GROUP BY date_trunc('week', p.paid_date)
        ORDER BY week_start ASC
      `;
      return rows.map((r) => ({
        weekStart: r.week_start.toISOString().split('T')[0],
        paidCount: Number(r.paid_count),
        dueCount: Number(r.due_count),
        rate: Number(r.due_count) > 0 ? Number(r.paid_count) / Number(r.due_count) : 0,
      }));
    } catch (err) {
      this.logger.error('weeklyCollectionRate query failed', err);
      return [];
    }
  }

  /**
   * Promises kept vs broken per week, from CallLog with result='PROMISED'.
   * A promise is "broken" if brokenAt is set in the week range;
   * "kept" if settlementDate is in the week range and brokenAt IS NULL.
   */
  private async promiseKeptTrend(
    since: Date,
  ): Promise<AnalyticsResult['promiseKeptTrend']> {
    try {
      const rows = await this.prisma.$queryRaw<PromiseKeptRow[]>`
        SELECT
          date_trunc('week', COALESCE(broken_at, settlement_date))::date AS week_start,
          COUNT(*) FILTER (WHERE broken_at IS NULL AND settlement_date IS NOT NULL) AS kept,
          COUNT(*) FILTER (WHERE broken_at IS NOT NULL) AS broken
        FROM call_logs
        WHERE deleted_at IS NULL
          AND result = 'PROMISED'
          AND COALESCE(broken_at, settlement_date) >= ${since}
          AND COALESCE(broken_at, settlement_date) IS NOT NULL
        GROUP BY date_trunc('week', COALESCE(broken_at, settlement_date))
        ORDER BY week_start ASC
      `;
      return rows.map((r) => ({
        weekStart: r.week_start.toISOString().split('T')[0],
        kept: Number(r.kept),
        broken: Number(r.broken),
      }));
    } catch (err) {
      this.logger.error('promiseKeptTrend query failed', err);
      return [];
    }
  }

  /**
   * DunningActions by day — count SENT vs FAILED.
   */
  private async dunningActionVolume(
    since: Date,
  ): Promise<AnalyticsResult['dunningActionVolume']> {
    try {
      const rows = await this.prisma.$queryRaw<DunningVolumeRow[]>`
        SELECT
          date_trunc('day', created_at)::date AS day,
          COUNT(*) FILTER (WHERE status = 'SENT') AS sent,
          COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
        FROM dunning_actions
        WHERE deleted_at IS NULL
          AND created_at >= ${since}
        GROUP BY date_trunc('day', created_at)
        ORDER BY day ASC
      `;
      return rows.map((r) => ({
        date: r.day.toISOString().split('T')[0],
        sent: Number(r.sent),
        failed: Number(r.failed),
      }));
    } catch (err) {
      this.logger.error('dunningActionVolume query failed', err);
      return [];
    }
  }

  /**
   * ContractLetters dispatched, grouped by type and month.
   */
  private async letterDispatchByType(
    since: Date,
  ): Promise<AnalyticsResult['letterDispatchByType']> {
    try {
      const rows = await this.prisma.$queryRaw<LetterDispatchRow[]>`
        SELECT
          letter_type,
          date_trunc('month', dispatched_at)::date AS month,
          COUNT(*) AS cnt
        FROM contract_letters
        WHERE deleted_at IS NULL
          AND dispatched_at IS NOT NULL
          AND dispatched_at >= ${since}
        GROUP BY letter_type, date_trunc('month', dispatched_at)
        ORDER BY month ASC, letter_type ASC
      `;
      return rows.map((r) => ({
        type: r.letter_type,
        month: r.month.toISOString().split('T')[0].substring(0, 7), // YYYY-MM
        count: Number(r.cnt),
      }));
    } catch (err) {
      this.logger.error('letterDispatchByType query failed', err);
      return [];
    }
  }

  /**
   * MdmLockRequests by day — proposed count + approved count.
   */
  private async mdmLockVolume(
    since: Date,
  ): Promise<AnalyticsResult['mdmLockVolume']> {
    try {
      const rows = await this.prisma.$queryRaw<MdmVolumeRow[]>`
        SELECT
          date_trunc('day', proposed_at)::date AS day,
          COUNT(*) AS proposed,
          COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved
        FROM mdm_lock_requests
        WHERE deleted_at IS NULL
          AND proposed_at >= ${since}
        GROUP BY date_trunc('day', proposed_at)
        ORDER BY day ASC
      `;
      return rows.map((r) => ({
        date: r.day.toISOString().split('T')[0],
        proposed: Number(r.proposed),
        approved: Number(r.approved),
      }));
    } catch (err) {
      this.logger.error('mdmLockVolume query failed', err);
      return [];
    }
  }
}
