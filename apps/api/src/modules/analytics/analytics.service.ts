import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { d } from '../../utils/decimal.util';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Monthly cohort retention analysis.
   * Groups customers by the month of their first contract,
   * then tracks what fraction are still making payments in subsequent months.
   */
  async getCohortAnalysis(branchId?: string) {
    const branchFilter = branchId
      ? Prisma.sql`AND c.branch_id = ${branchId}`
      : Prisma.empty;

    // Build cohorts: for each (cohort_month, offset_month) count active payers
    const rows = await this.prisma.$queryRaw<
      {
        cohortMonth: string;
        offsetMonth: number;
        customerCount: number;
      }[]
    >(Prisma.sql`
      WITH first_contracts AS (
        SELECT
          c.customer_id,
          DATE_TRUNC('month', MIN(c.created_at)) AS cohort_month
        FROM contracts c
        WHERE c.deleted_at IS NULL
          ${branchFilter}
        GROUP BY c.customer_id
      ),
      customer_activity AS (
        SELECT
          fc.customer_id,
          fc.cohort_month,
          DATE_TRUNC('month', p.paid_date) AS activity_month
        FROM first_contracts fc
        JOIN contracts c ON c.customer_id = fc.customer_id AND c.deleted_at IS NULL
        JOIN payments p ON p.contract_id = c.id AND p.status = 'PAID' AND p.paid_date IS NOT NULL
      )
      SELECT
        TO_CHAR(cohort_month, 'YYYY-MM') AS "cohortMonth",
        EXTRACT(MONTH FROM AGE(activity_month, cohort_month))::int +
          EXTRACT(YEAR FROM AGE(activity_month, cohort_month))::int * 12 AS "offsetMonth",
        COUNT(DISTINCT customer_id) AS "customerCount"
      FROM customer_activity
      WHERE activity_month >= cohort_month
      GROUP BY cohort_month, "offsetMonth"
      ORDER BY cohort_month, "offsetMonth"
    `);

    // Build cohort sizes (offset 0 = initial cohort)
    const cohortSizes: Record<string, number> = {};
    for (const row of rows) {
      if (row.offsetMonth === 0) {
        cohortSizes[row.cohortMonth] = Number(row.customerCount);
      }
    }

    // Group by cohortMonth
    const cohortMap: Record<string, Record<number, number>> = {};
    for (const row of rows) {
      if (!cohortMap[row.cohortMonth]) cohortMap[row.cohortMonth] = {};
      cohortMap[row.cohortMonth][row.offsetMonth] = Number(row.customerCount);
    }

    const maxOffset = rows.reduce((max, r) => Math.max(max, r.offsetMonth), 0);

    const cohorts = Object.entries(cohortMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, offsets]) => {
        const size = cohortSizes[month] || offsets[0] || 0;
        const retention: number[] = [];
        for (let i = 0; i <= maxOffset; i++) {
          const count = offsets[i] || 0;
          retention.push(size > 0 ? Math.round((count / size) * 100) : 0);
        }
        return {
          month,
          customers: size,
          retention,
        };
      });

    return {
      cohorts,
      maxOffset,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Revenue forecast using simple linear regression on last 6 months of data.
   * Returns historical + 3-month forecast with confidence interval.
   */
  async getRevenueForecast(branchId?: string) {
    const branchFilter = branchId
      ? Prisma.sql`AND c.branch_id = ${branchId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { month: string; amount: string }[]
    >(Prisma.sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', p.paid_date), 'YYYY-MM') AS month,
        SUM(p.amount_paid)::text AS amount
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id AND c.deleted_at IS NULL
      WHERE p.status = 'PAID'
        AND p.paid_date IS NOT NULL
        AND p.paid_date >= NOW() - INTERVAL '6 months'
        ${branchFilter}
      GROUP BY DATE_TRUNC('month', p.paid_date)
      ORDER BY month ASC
    `);

    const historical = rows.map((r) => ({
      month: r.month,
      amount: d(r.amount).toNumber(),
    }));

    if (historical.length < 2) {
      return {
        historical,
        forecast: [],
        note: 'ข้อมูลไม่เพียงพอสำหรับการพยากรณ์ (ต้องการอย่างน้อย 2 เดือน)',
      };
    }

    // Linear regression: y = a + b*x, where x = index (0, 1, 2, ...)
    const n = historical.length;
    const xs = historical.map((_, i) => i);
    const ys = historical.map((h) => h.amount);

    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);

    const b = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const a = (sumY - b * sumX) / n;

    // Residual standard error for confidence interval
    const residuals = ys.map((y, i) => y - (a + b * i));
    const sse = residuals.reduce((s, r) => s + r * r, 0);
    const stdError = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;

    // Generate next 3 months
    const lastMonth = historical[historical.length - 1].month;
    const forecast: Array<{ month: string; amount: number; lower: number; upper: number; confidence: number }> = [];
    for (let i = 1; i <= 3; i++) {
      const [year, month] = lastMonth.split('-').map(Number);
      const d = new Date(year, month - 1 + i, 1);
      const forecastMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const xForecast = n - 1 + i;
      const predictedAmount = Math.max(0, a + b * xForecast);
      // 80% confidence interval (±1.28 * stdError)
      const margin = 1.28 * stdError;
      forecast.push({
        month: forecastMonth,
        amount: Math.round(predictedAmount),
        lower: Math.max(0, Math.round(predictedAmount - margin)),
        upper: Math.round(predictedAmount + margin),
        confidence: 80,
      });
    }

    return {
      historical,
      forecast,
      trend: b > 0 ? 'up' : b < 0 ? 'down' : 'flat',
      monthlyGrowthRate: historical.length > 1 && historical[0].amount > 0
        ? Math.round((b / (a || 1)) * 100 * 10) / 10
        : 0,
    };
  }

  /**
   * Sales heatmap: aggregate sales by day-of-week × hour.
   * Useful for staffing decisions.
   */
  async getSalesHeatmap(branchId?: string, months = 3) {
    const branchFilter = branchId
      ? Prisma.sql`AND s.branch_id = ${branchId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { day: number; hour: number; count: string; amount: string }[]
    >(Prisma.sql`
      SELECT
        EXTRACT(DOW FROM s.created_at)::int AS day,
        EXTRACT(HOUR FROM s.created_at)::int AS hour,
        COUNT(s.id)::text AS count,
        COALESCE(SUM(s.total_amount), 0)::text AS amount
      FROM sales s
      WHERE s.deleted_at IS NULL
        AND s.created_at >= NOW() - (${months} || ' months')::interval
        ${branchFilter}
      GROUP BY day, hour
      ORDER BY day, hour
    `);

    const heatmap = rows.map((r) => ({
      day: Number(r.day),
      hour: Number(r.hour),
      count: parseInt(r.count) || 0,
      amount: d(r.amount).toNumber(),
    }));

    const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];

    // Summary: peak day + peak hour
    let peakEntry = heatmap[0] || { day: 0, hour: 0, count: 0, amount: 0 };
    for (const entry of heatmap) {
      if (entry.count > peakEntry.count) peakEntry = entry;
    }

    return {
      heatmap,
      dayNames,
      peakDay: peakEntry ? { day: peakEntry.day, name: dayNames[peakEntry.day] } : null,
      peakHour: peakEntry ? peakEntry.hour : null,
      periodMonths: months,
      generatedAt: new Date().toISOString(),
    };
  }
}
