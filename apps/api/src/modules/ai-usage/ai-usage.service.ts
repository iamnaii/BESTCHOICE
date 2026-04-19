import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { computeCostUsd } from './ai-pricing';

export interface UsageRecord {
  service: string;
  method?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  userId?: string;
  status: 'success' | 'error';
  errorKind?: string;
}

export interface BreakdownQuery {
  from?: string;
  to?: string;
  groupBy: 'service' | 'model' | 'user';
}

export interface LogsQuery {
  page: number;
  limit: number;
  service?: string;
  status?: 'success' | 'error';
}

/**
 * Centralized logger for every Claude API call. Kept fire-and-forget so
 * audit logging never blocks or fails a customer-facing AI call. The hourly
 * cron reads from this table to compute running daily spend.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async record(entry: UsageRecord): Promise<void> {
    try {
      const costUsd = computeCostUsd(entry.model, entry.inputTokens, entry.outputTokens);
      await this.prisma.aiUsageLog.create({
        data: {
          service: entry.service,
          method: entry.method ?? null,
          model: entry.model,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          costUsd: new Prisma.Decimal(costUsd),
          userId: entry.userId ?? null,
          status: entry.status,
          errorKind: entry.errorKind ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist AI usage for ${entry.service}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, { tags: { module: 'ai-usage', action: 'record' } });
    }
  }

  /**
   * Admin dashboard summary — today's spend vs daily budget + running totals for
   * 7d/30d. All times are Asia/Bangkok day boundaries so the numbers line up
   * with the ai-budget cron.
   */
  async getSummary() {
    const budget = Number(this.config.get<string>('ANTHROPIC_DAILY_BUDGET_USD') ?? '10');

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    thirtyDaysAgo.setUTCHours(0, 0, 0, 0);

    const [todayAgg, sevenDayAgg, thirtyDayAgg, todayByService, errorCount] = await Promise.all([
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: todayStart } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: sevenDaysAgo } },
        _sum: { costUsd: true },
        _count: true,
      }),
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo } },
        _sum: { costUsd: true },
        _count: true,
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['service'],
        where: { createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
        _count: true,
      }),
      this.prisma.aiUsageLog.count({
        where: { createdAt: { gte: todayStart }, status: 'error' },
      }),
    ]);

    const todayCost = Number(todayAgg._sum.costUsd ?? 0);
    const percentOfBudget = budget > 0 ? (todayCost / budget) * 100 : 0;

    return {
      budget: {
        dailyUsd: budget,
        todayUsd: todayCost,
        percentUsed: percentOfBudget,
        breached: todayCost > budget,
        alertThreshold: budget * 0.8,
      },
      today: {
        calls: todayAgg._count,
        costUsd: todayCost,
        inputTokens: Number(todayAgg._sum.inputTokens ?? 0),
        outputTokens: Number(todayAgg._sum.outputTokens ?? 0),
        errorCount,
        errorRate: todayAgg._count > 0 ? (errorCount / todayAgg._count) * 100 : 0,
      },
      sevenDays: {
        calls: sevenDayAgg._count,
        costUsd: Number(sevenDayAgg._sum.costUsd ?? 0),
      },
      thirtyDays: {
        calls: thirtyDayAgg._count,
        costUsd: Number(thirtyDayAgg._sum.costUsd ?? 0),
      },
      todayByService: todayByService.map((row) => ({
        service: row.service,
        calls: row._count,
        costUsd: Number(row._sum.costUsd ?? 0),
      })),
    };
  }

  /**
   * Cost/call breakdown within a date range, grouped by service, model, or
   * user. Defaults to last 30 days. Used by the admin breakdown table.
   */
  async getBreakdown(q: BreakdownQuery) {
    const where = this.buildDateRange(q.from, q.to);

    if (q.groupBy === 'model') {
      const rows = await this.prisma.aiUsageLog.groupBy({
        by: ['model'],
        where,
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      });
      return rows
        .map((r) => ({
          key: r.model,
          calls: r._count,
          costUsd: Number(r._sum.costUsd ?? 0),
          inputTokens: Number(r._sum.inputTokens ?? 0),
          outputTokens: Number(r._sum.outputTokens ?? 0),
        }))
        .sort((a, b) => b.costUsd - a.costUsd);
    }

    if (q.groupBy === 'user') {
      const rows = await this.prisma.aiUsageLog.groupBy({
        by: ['userId'],
        where,
        _sum: { costUsd: true },
        _count: true,
      });
      return rows
        .map((r) => ({
          key: r.userId ?? 'system',
          calls: r._count,
          costUsd: Number(r._sum.costUsd ?? 0),
        }))
        .sort((a, b) => b.costUsd - a.costUsd);
    }

    const rows = await this.prisma.aiUsageLog.groupBy({
      by: ['service'],
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    });
    return rows
      .map((r) => ({
        key: r.service,
        calls: r._count,
        costUsd: Number(r._sum.costUsd ?? 0),
        inputTokens: Number(r._sum.inputTokens ?? 0),
        outputTokens: Number(r._sum.outputTokens ?? 0),
      }))
      .sort((a, b) => b.costUsd - a.costUsd);
  }

  /**
   * Daily cost trend for the last N days (Asia/Bangkok day buckets). Returns
   * entries for every day in the window including zero-spend days so the
   * chart doesn't leave gaps.
   */
  async getDailyTrend(days: number) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const rows = await this.prisma.aiUsageLog.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, costUsd: true, service: true },
    });

    const buckets = new Map<string, { date: string; costUsd: number; calls: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { date: key, costUsd: 0, calls: 0 });
    }

    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.costUsd += Number(row.costUsd);
        bucket.calls += 1;
      }
    }

    return Array.from(buckets.values());
  }

  /**
   * Paginated log list for the admin table. Newest first. Results are capped
   * at 200 per page by the controller.
   */
  async getLogs(q: LogsQuery) {
    const where: Prisma.AiUsageLogWhereInput = {};
    if (q.service) where.service = q.service;
    if (q.status) where.status = q.status;

    const [rows, total] = await Promise.all([
      this.prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.aiUsageLog.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        service: r.service,
        method: r.method,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: Number(r.costUsd),
        userId: r.userId,
        status: r.status,
        errorKind: r.errorKind,
        createdAt: r.createdAt,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  private buildDateRange(from?: string, to?: string): Prisma.AiUsageLogWhereInput {
    const where: Prisma.AiUsageLogWhereInput = {};
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
      if (to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(to);
    } else {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      where.createdAt = { gte: thirtyDaysAgo };
    }
    return where;
  }
}
