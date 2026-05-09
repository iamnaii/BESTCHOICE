import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Aging buckets used by Collections AnalyticsTab (Task 15).
 * Codes match the OverdueBucket enum (queue-query.dto.ts) so clicking a
 * bar can deep-link straight into QueueTab with the same bucket filter.
 */
export type AgingBucketCode = '1-7' | '8-30' | '31-60' | '61-90' | '90+';

export interface AgingBucketRow {
  bucket: AgingBucketCode;
  count: number;
  outstanding: number;
}

interface RawRow {
  bucket: string;
  cnt: bigint;
  outstanding: number | string | null;
}

@Injectable()
export class AnalyticsAgingService {
  private readonly logger = new Logger(AnalyticsAgingService.name);
  // 5-minute in-memory cache per branch scope key
  private cache = new Map<string, { value: AgingBucketRow[]; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(private prisma: PrismaService) {}

  async getAgingBuckets(params: {
    userRole: string;
    userBranchId: string | null;
  }): Promise<AgingBucketRow[]> {
    const branchScope =
      params.userRole === 'BRANCH_MANAGER' ? params.userBranchId ?? '__all__' : '__all__';
    const cacheKey = branchScope;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = await this.compute(branchScope === '__all__' ? null : branchScope);
    this.cache.set(cacheKey, { value, expiresAt: now + this.CACHE_TTL_MS });
    return value;
  }

  private async compute(branchId: string | null): Promise<AgingBucketRow[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<RawRow[]>(
        `
        WITH oldest AS (
          SELECT
            p.contract_id,
            MIN(p.due_date) AS oldest_due,
            SUM((p.amount_due - p.amount_paid + p.late_fee))::numeric AS outstanding
          FROM payments p
          INNER JOIN contracts c ON c.id = p.contract_id
          WHERE p.deleted_at IS NULL
            AND c.deleted_at IS NULL
            AND c.status IN ('OVERDUE', 'DEFAULT', 'TERMINATED')
            AND p.status IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
            AND p.due_date < NOW()
            ${branchId ? 'AND c.branch_id = $1' : ''}
          GROUP BY p.contract_id
        ),
        bucketed AS (
          SELECT
            CASE
              WHEN (CURRENT_DATE - oldest_due::date) BETWEEN 1 AND 7 THEN '1-7'
              WHEN (CURRENT_DATE - oldest_due::date) BETWEEN 8 AND 30 THEN '8-30'
              WHEN (CURRENT_DATE - oldest_due::date) BETWEEN 31 AND 60 THEN '31-60'
              WHEN (CURRENT_DATE - oldest_due::date) BETWEEN 61 AND 90 THEN '61-90'
              WHEN (CURRENT_DATE - oldest_due::date) > 90 THEN '90+'
              ELSE NULL
            END AS bucket,
            outstanding
          FROM oldest
        )
        SELECT bucket, COUNT(*)::bigint AS cnt, SUM(outstanding)::numeric AS outstanding
        FROM bucketed
        WHERE bucket IS NOT NULL
        GROUP BY bucket
        `,
        ...(branchId ? [branchId] : []),
      );

      const order: AgingBucketCode[] = ['1-7', '8-30', '31-60', '61-90', '90+'];
      const map = new Map<AgingBucketCode, AgingBucketRow>();
      for (const code of order) map.set(code, { bucket: code, count: 0, outstanding: 0 });
      for (const r of rows) {
        const code = r.bucket as AgingBucketCode;
        if (!map.has(code)) continue;
        map.set(code, {
          bucket: code,
          count: Number(r.cnt),
          outstanding: r.outstanding == null ? 0 : Number(r.outstanding),
        });
      }
      return order.map((c) => map.get(c)!);
    } catch (err) {
      this.logger.error('aging buckets query failed', err);
      return [
        { bucket: '1-7', count: 0, outstanding: 0 },
        { bucket: '8-30', count: 0, outstanding: 0 },
        { bucket: '31-60', count: 0, outstanding: 0 },
        { bucket: '61-90', count: 0, outstanding: 0 },
        { bucket: '90+', count: 0, outstanding: 0 },
      ];
    }
  }
}
