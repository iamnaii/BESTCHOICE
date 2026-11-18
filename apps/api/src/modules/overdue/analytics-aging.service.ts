import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sqlBkkDate } from '../../utils/bangkok-sql.util';
import { bangkokDateString } from '../../utils/date.util';

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
      // อายุหนี้ = วันนี้ตามปฏิทินไทย − วันครบกำหนดของงวดเก่าสุดตามปฏิทินไทย (2026-11-18)
      // due_date เก็บเที่ยงคืนไทย (= 17:00Z ของวันก่อน) ⇒ เดิม CURRENT_DATE - oldest_due::date ได้อายุเกินจริง 1 วัน
      // และ CURRENT_DATE ตาม TZ ของ session ฐานข้อมูล — วันนี้จึงคำนวณใน JS แล้วส่งเป็นพารามิเตอร์
      const today = bangkokDateString();
      const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
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
            ${branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty}
          GROUP BY p.contract_id
        ),
        aged AS (
          SELECT ${today}::date - ${sqlBkkDate('oldest_due')} AS days, outstanding
          FROM oldest
        ),
        bucketed AS (
          SELECT
            CASE
              WHEN days BETWEEN 1 AND 7 THEN '1-7'
              WHEN days BETWEEN 8 AND 30 THEN '8-30'
              WHEN days BETWEEN 31 AND 60 THEN '31-60'
              WHEN days BETWEEN 61 AND 90 THEN '61-90'
              WHEN days > 90 THEN '90+'
              ELSE NULL
            END AS bucket,
            outstanding
          FROM aged
        )
        SELECT bucket, COUNT(*)::bigint AS cnt, SUM(outstanding)::numeric AS outstanding
        FROM bucketed
        WHERE bucket IS NOT NULL
        GROUP BY bucket
      `);

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
