import { Injectable, Logger } from '@nestjs/common';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueAnalyticsService } from '../overdue/analytics.service';
import { AnalyticsAgingService } from '../overdue/analytics-aging.service';
import { AnalyticsLeaderboardService } from '../overdue/analytics-leaderboard.service';
import { AnalyticsRecoveryService } from '../overdue/analytics-recovery.service';
import { StuckContractsService } from '../overdue/stuck-contracts.service';

export interface PdfDateRange {
  from: Date;
  to: Date;
}

/**
 * Server-side PDF report generator.
 *
 * **Implementation choice**: pure jspdf (text + autoTable) — no html2canvas
 * because html2canvas requires a real browser DOM. Charts are rendered as
 * compact summary tables instead of bitmaps. If we ever need true rendered
 * charts on the server we can swap to puppeteer (already in deps) at the
 * cost of cold-start latency (~2s) and memory.
 */
@Injectable()
export class PdfReportService {
  private readonly logger = new Logger(PdfReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: OverdueAnalyticsService,
    private readonly aging: AnalyticsAgingService,
    private readonly leaderboard: AnalyticsLeaderboardService,
    private readonly recovery: AnalyticsRecoveryService,
    private readonly stuck: StuckContractsService,
  ) {}

  /**
   * Generate the weekly collections analytics PDF as a Buffer.
   * Cover + KPI strip + aging + leaderboard + recovery + stuck + letter dispatch + promise trend.
   */
  async generate(range: PdfDateRange): Promise<Buffer> {
    const days = Math.max(
      7,
      Math.round((range.to.getTime() - range.from.getTime()) / 86400000),
    );
    const analyticsRange: '30d' | '90d' = days <= 45 ? '30d' : '90d';

    // Fetch all data in parallel.
    const [analytics, agingBuckets, leaderboardRows, recoveryRows, stuckRows] =
      await Promise.all([
        this.analytics.getAnalytics({ range: analyticsRange }),
        this.aging
          .getAgingBuckets({ userRole: 'OWNER', userBranchId: null })
          .catch(() => null),
        this.leaderboard.getLeaderboard().catch(() => []),
        this.recovery.getRecoveryByChannel({ from: range.from, to: range.to }).catch(() => []),
        this.stuck.getStuckContracts({ days: 14 }).catch(() => []),
      ]);

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const formatDate = (d: Date) => d.toISOString().slice(0, 10);

    // ---- Cover page ----
    doc.setFontSize(22);
    doc.text('BESTCHOICE Collections Report', 40, 80);
    doc.setFontSize(12);
    doc.text(`Period: ${formatDate(range.from)} -> ${formatDate(range.to)}`, 40, 110);
    doc.text(`Generated: ${new Date().toISOString()}`, 40, 130);

    // ---- KPI strip ----
    let y = 170;
    doc.setFontSize(14);
    doc.text('Key Indicators', 40, y);
    y += 10;
    const totalDue = analytics.weeklyCollectionRate.reduce((s, r) => s + r.dueCount, 0);
    const totalPaid = analytics.weeklyCollectionRate.reduce((s, r) => s + r.paidCount, 0);
    const collectionRate = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
    const totalKept = analytics.promiseKeptTrend.reduce((s, r) => s + r.kept, 0);
    const totalBroken = analytics.promiseKeptTrend.reduce((s, r) => s + r.broken, 0);
    const totalSent = analytics.dunningActionVolume.reduce((s, r) => s + r.sent, 0);
    const totalFailed = analytics.dunningActionVolume.reduce((s, r) => s + r.failed, 0);
    autoTable(doc, {
      startY: y,
      head: [['KPI', 'Value']],
      body: [
        ['Collection rate', `${collectionRate}%`],
        ['Promises kept / broken', `${totalKept} / ${totalBroken}`],
        ['Dunning sent / failed', `${totalSent} / ${totalFailed}`],
        ['Stuck contracts (>=14d)', String(stuckRows.length)],
      ],
      styles: { fontSize: 10 },
    });

    // ---- Aging buckets ----
    if (Array.isArray(agingBuckets) && agingBuckets.length > 0) {
      autoTable(doc, {
        head: [['Aging bucket', 'Contracts', 'Outstanding']],
        body: agingBuckets.map((b) => [b.bucket, String(b.count), String(b.outstanding)]),
        styles: { fontSize: 10 },
      });
    }

    // ---- Leaderboard ----
    if (Array.isArray(leaderboardRows) && leaderboardRows.length > 0) {
      autoTable(doc, {
        head: [['Collector', 'Contracts', 'Collected']],
        body: leaderboardRows.slice(0, 10).map((r) => {
          const row = r as { name?: string; contractsHandled?: number; amountCollected?: string | number };
          return [row.name ?? '-', String(row.contractsHandled ?? 0), String(row.amountCollected ?? 0)];
        }),
        styles: { fontSize: 10 },
      });
    }

    // ---- Recovery rate by channel ----
    if (Array.isArray(recoveryRows) && recoveryRows.length > 0) {
      autoTable(doc, {
        head: [['Channel', 'Sent', 'Recovered', 'Rate']],
        body: recoveryRows.map((r) => {
          const row = r as { channel?: string; sent?: number; recovered?: number; rate?: number };
          return [
            row.channel ?? '-',
            String(row.sent ?? 0),
            String(row.recovered ?? 0),
            row.rate != null ? `${Math.round(row.rate * 100)}%` : '-',
          ];
        }),
        styles: { fontSize: 10 },
      });
    }

    // ---- Stuck contracts ----
    if (stuckRows.length > 0) {
      autoTable(doc, {
        head: [['Contract #', 'Days stuck', 'Customer', 'Status']],
        body: stuckRows.slice(0, 20).map((r) => {
          const row = r as {
            contractNumber?: string;
            daysStuck?: number;
            customerName?: string;
            status?: string;
          };
          return [
            row.contractNumber ?? '-',
            String(row.daysStuck ?? 0),
            row.customerName ?? '-',
            row.status ?? '-',
          ];
        }),
        styles: { fontSize: 9 },
      });
    }

    // ---- Letter dispatch by type ----
    if (analytics.letterDispatchByType.length > 0) {
      autoTable(doc, {
        head: [['Letter type', 'Month', 'Count']],
        body: analytics.letterDispatchByType.map((r) => [r.type, r.month.slice(0, 7), String(r.count)]),
        styles: { fontSize: 10 },
      });
    }

    // ---- Promise trend ----
    if (analytics.promiseKeptTrend.length > 0) {
      autoTable(doc, {
        head: [['Week', 'Kept', 'Broken']],
        body: analytics.promiseKeptTrend.map((r) => [
          r.weekStart.slice(0, 10),
          String(r.kept),
          String(r.broken),
        ]),
        styles: { fontSize: 10 },
      });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  /**
   * Read recipient list from SystemConfig (key=pdf_report_recipients).
   * Returns empty array when key missing or value blank.
   */
  async getRecipients(): Promise<string[]> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: 'pdf_report_recipients' },
    });
    if (!row || !row.value) return [];
    return row.value
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  }

  /**
   * Replace recipient list. Comma-joined and stored in SystemConfig.
   */
  async setRecipients(recipients: string[]): Promise<{ recipients: string[] }> {
    const value = recipients.map((e) => e.trim()).filter(Boolean).join(',');
    await this.prisma.systemConfig.upsert({
      where: { key: 'pdf_report_recipients' },
      update: { value, label: 'Weekly PDF report recipients' },
      create: { key: 'pdf_report_recipients', value, label: 'Weekly PDF report recipients' },
    });
    return { recipients: recipients.map((e) => e.trim()).filter(Boolean) };
  }
}
