import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LeaderboardRow {
  collectorId: string;
  name: string;
  assignedCount: number;
  promiseKeptPercent: number;
  avgDaysToFirstContact: number;
  recoveryThisMonth: number;
}

interface RawLeaderboardRow {
  collector_id: string;
  name: string;
  assigned_count: bigint;
  promise_kept: bigint;
  promise_total: bigint;
  avg_days_to_first_contact: number | string | null;
  recovery_this_month: number | string | null;
}

@Injectable()
export class AnalyticsLeaderboardService {
  private readonly logger = new Logger(AnalyticsLeaderboardService.name);
  private cache: { value: LeaderboardRow[]; expiresAt: number } | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(private prisma: PrismaService) {}

  async getLeaderboard(): Promise<LeaderboardRow[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.value;
    const value = await this.compute();
    this.cache = { value, expiresAt: now + this.CACHE_TTL_MS };
    return value;
  }

  private async compute(): Promise<LeaderboardRow[]> {
    try {
      // Single CTE-based aggregate: assigned contracts + promise kept ratio
      // + avg days from contract assignment-equivalent (createdAt of first
      // CallLog after assignment) + recovery this month (sum of payments
      // amountPaid where paidDate in current month, recordedById = collector).
      const rows = await this.prisma.$queryRawUnsafe<RawLeaderboardRow[]>(`
        WITH active_collectors AS (
          SELECT u.id AS collector_id, u.name
          FROM users u
          WHERE u.deleted_at IS NULL
            AND u.role IN ('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
        ),
        assigned AS (
          SELECT c.assigned_to_id AS collector_id, COUNT(*)::bigint AS assigned_count
          FROM contracts c
          WHERE c.deleted_at IS NULL
            AND c.assigned_to_id IS NOT NULL
            AND c.status IN ('OVERDUE', 'DEFAULT', 'LEGAL')
          GROUP BY c.assigned_to_id
        ),
        promises AS (
          SELECT cl.caller_id AS collector_id,
                 COUNT(*) FILTER (WHERE cl.broken_at IS NULL AND cl.settlement_date IS NOT NULL AND cl.settlement_date < NOW())::bigint AS kept,
                 COUNT(*) FILTER (WHERE cl.settlement_date IS NOT NULL AND cl.settlement_date < NOW())::bigint AS total
          FROM call_logs cl
          WHERE cl.deleted_at IS NULL
            AND cl.result = 'PROMISED'
            AND cl.called_at >= NOW() - INTERVAL '90 days'
          GROUP BY cl.caller_id
        ),
        first_contact AS (
          SELECT cl.caller_id AS collector_id,
                 AVG(EXTRACT(EPOCH FROM (cl.called_at - c.created_at)) / 86400.0) AS avg_days
          FROM call_logs cl
          INNER JOIN contracts c ON c.id = cl.contract_id
          WHERE cl.deleted_at IS NULL
            AND cl.called_at >= NOW() - INTERVAL '90 days'
          GROUP BY cl.caller_id
        ),
        recovery AS (
          SELECT p.recorded_by_id AS collector_id,
                 SUM(p.amount_paid)::numeric AS recovery_amt
          FROM payments p
          WHERE p.deleted_at IS NULL
            AND p.recorded_by_id IS NOT NULL
            AND p.paid_date >= date_trunc('month', NOW())
          GROUP BY p.recorded_by_id
        )
        SELECT
          ac.collector_id,
          ac.name,
          COALESCE(a.assigned_count, 0) AS assigned_count,
          COALESCE(p.kept, 0) AS promise_kept,
          COALESCE(p.total, 0) AS promise_total,
          COALESCE(fc.avg_days, 0) AS avg_days_to_first_contact,
          COALESCE(r.recovery_amt, 0) AS recovery_this_month
        FROM active_collectors ac
        LEFT JOIN assigned a ON a.collector_id = ac.collector_id
        LEFT JOIN promises p ON p.collector_id = ac.collector_id
        LEFT JOIN first_contact fc ON fc.collector_id = ac.collector_id
        LEFT JOIN recovery r ON r.collector_id = ac.collector_id
        WHERE
          COALESCE(a.assigned_count, 0) > 0
          OR COALESCE(p.total, 0) > 0
          OR COALESCE(r.recovery_amt, 0) > 0
        ORDER BY recovery_this_month DESC, assigned_count DESC
      `);

      return rows.map((r) => {
        const total = Number(r.promise_total);
        const kept = Number(r.promise_kept);
        return {
          collectorId: r.collector_id,
          name: r.name,
          assignedCount: Number(r.assigned_count),
          promiseKeptPercent: total > 0 ? Math.round((kept / total) * 1000) / 10 : 0,
          avgDaysToFirstContact:
            r.avg_days_to_first_contact == null
              ? 0
              : Math.round(Number(r.avg_days_to_first_contact) * 10) / 10,
          recoveryThisMonth:
            r.recovery_this_month == null ? 0 : Number(r.recovery_this_month),
        };
      });
    } catch (err) {
      this.logger.error('leaderboard query failed', err);
      return [];
    }
  }
}
