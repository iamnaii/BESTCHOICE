import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from './reports.service';
import { addBkkDays, bangkokDateString, bangkokStartOfDay } from '../../utils/date.util';

/**
 * Auto-generates daily/weekly summary reports and stores them in DB.
 * Called by the scheduler cron job.
 */
@Injectable()
export class ReportGeneratorService {
  private readonly logger = new Logger(ReportGeneratorService.name);

  constructor(
    private prisma: PrismaService,
    private reportsService: ReportsService,
  ) {}

  /**
   * Generate daily summary report (stored as JSON in SystemConfig).
   * Includes: revenue, payments, overdue, contracts created.
   */
  async generateDailySummary(date?: Date): Promise<{
    date: string;
    revenue: number;
    paymentsCount: number;
    overdueCount: number;
    newContracts: number;
    newCustomers: number;
  }> {
    const d = date || new Date();
    const startOfDay = bangkokStartOfDay(d);
    const endOfDay = addBkkDays(startOfDay, 1);
    const dateStr = bangkokDateString(d);

    const [payments, newContracts, newCustomers, overdueCount] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { paidDate: { gte: startOfDay, lt: endOfDay }, status: 'PAID', deletedAt: null },
        _sum: { amountPaid: true },
        _count: true,
      }),
      this.prisma.contract.count({
        where: { createdAt: { gte: startOfDay, lt: endOfDay }, deletedAt: null },
      }),
      this.prisma.customer.count({
        where: { createdAt: { gte: startOfDay, lt: endOfDay }, deletedAt: null },
      }),
      this.prisma.payment.count({
        where: {
          status: { in: ['OVERDUE', 'PENDING'] },
          dueDate: { lt: startOfDay },
          deletedAt: null,
        },
      }),
    ]);

    const summary = {
      date: dateStr,
      revenue: new Prisma.Decimal(payments._sum.amountPaid ?? 0).toDecimalPlaces(0).toNumber(),
      paymentsCount: payments._count,
      overdueCount,
      newContracts,
      newCustomers,
    };

    // Store in SystemConfig for quick retrieval
    const key = `daily_report_${dateStr}`;
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(summary) },
      create: { key, value: JSON.stringify(summary) },
    });

    this.logger.log(`Daily report generated for ${dateStr}: ฿${summary.revenue.toLocaleString()}, ${summary.paymentsCount} payments`);
    return summary;
  }

  /**
   * Generate weekly summary (aggregates 7 daily reports).
   */
  async generateWeeklySummary(): Promise<{
    weekStart: string;
    weekEnd: string;
    totalRevenue: number;
    totalPayments: number;
    avgDailyRevenue: number;
    dailySummaries: Record<string, unknown>[];
  }> {
    const weekEnd = bangkokStartOfDay(new Date());
    const weekStart = addBkkDays(weekEnd, -7);

    const dailySummaries: Record<string, unknown>[] = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = bangkokDateString(addBkkDays(weekStart, i));
      const key = `daily_report_${dateStr}`;
      const config = await this.prisma.systemConfig.findUnique({ where: { key } });
      if (config) {
        try { dailySummaries.push(JSON.parse(config.value)); } catch { /* skip */ }
      }
    }

    const totalRevenue = dailySummaries.reduce((s, d) => s + (Number(d.revenue) || 0), 0);
    const totalPayments = dailySummaries.reduce((s, d) => s + (Number(d.paymentsCount) || 0), 0);

    const summary = {
      weekStart: bangkokDateString(weekStart),
      // วันสุดท้ายที่รวมจริง (อาทิตย์) — ค่าเดิมก็เป็นวันนี้ จึงไม่เปลี่ยน
      weekEnd: bangkokDateString(addBkkDays(weekEnd, -1)),
      totalRevenue,
      totalPayments,
      avgDailyRevenue: Math.round(totalRevenue / 7),
      dailySummaries,
    };

    const key = `weekly_report_${summary.weekStart}`;
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(summary) },
      create: { key, value: JSON.stringify(summary) },
    });

    this.logger.log(`Weekly report: ${summary.weekStart} → ${summary.weekEnd}, ฿${totalRevenue.toLocaleString()}`);
    return summary;
  }

  /** Get latest daily report */
  async getLatestDailyReport() {
    const dateStr = new Date().toISOString().slice(0, 10);
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: `daily_report_${dateStr}` },
    });
    if (!config) return null;
    try { return JSON.parse(config.value); } catch { return null; }
  }
}
