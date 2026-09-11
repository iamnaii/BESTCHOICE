import { DOCUMENT_STYLE } from '@installment/shared';
import { registerDocumentFont } from '../../assets/fonts/document-fonts';
import { Injectable, Logger } from '@nestjs/common';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokDateString } from '../../utils/date.util';
import { OverdueAnalyticsService } from '../overdue/analytics.service';
import { AnalyticsAgingService } from '../overdue/analytics-aging.service';
import { AnalyticsLeaderboardService, LeaderboardRow } from '../overdue/analytics-leaderboard.service';
import { AnalyticsRecoveryService, RecoveryByChannelRow } from '../overdue/analytics-recovery.service';
import { StuckContractsService, StuckContractRow } from '../overdue/stuck-contracts.service';

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

    // Fetch all data in parallel. The rows keep the services' own types so a renamed
    // field fails to compile instead of silently printing 0 / "-" (DOC-10, #1569).
    const [analytics, agingBuckets, leaderboardRows, recoveryRows, stuckRows] =
      await Promise.all([
        this.analytics.getAnalytics({ range: analyticsRange }),
        this.aging
          .getAgingBuckets({ userRole: 'OWNER', userBranchId: null })
          .catch(() => null),
        this.leaderboard.getLeaderboard().catch((): LeaderboardRow[] => []),
        this.recovery
          .getRecoveryByChannel({ from: range.from, to: range.to })
          .catch((): RecoveryByChannelRow[] => []),
        this.stuck.getStuckContracts({ days: 14 }).catch((): StuckContractRow[] => []),
      ]);

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const font = registerDocumentFont(doc);
    const green: [number, number, number] = [6, 95, 70];
    const ink: [number, number, number] = [23, 43, 37];
    const tableStyles = { font, fontSize: DOCUMENT_STYLE.bodyPt, cellPadding: 5.25, textColor: ink };
    const margin = { top: 117, bottom: 51, left: 43, right: 43 };
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    // The period the user picked is a Bangkok calendar range; the header must not slip a day
    // when the range starts at 00:00 Bangkok (= 17:00 UTC the day before).
    const formatDate = (d: Date) => bangkokDateString(d);
    const generated = new Date().toISOString();
    doc.setLineHeightFactor(1.2);
    let y = margin.top;

    // Keep each section title with its table header and at least one data row.
    const table = (title: string, head: string[][], body: string[][]) => {
      if (y + 94 > pageHeight - margin.bottom) {
        doc.addPage();
        y = margin.top;
      }
      doc.setFont(font, 'bold');
      doc.setFontSize(DOCUMENT_STYLE.headingPt);
      doc.setTextColor(...green);
      doc.text(title, margin.left, y + 15);
      autoTable(doc, {
        startY: y + 23,
        head, body, styles: tableStyles, margin,
        headStyles: { fillColor: green, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [246, 249, 247] },
        rowPageBreak: 'avoid',
        didParseCell: cell => {
          if (['Contracts', 'Outstanding', 'Collected', 'Sent', 'Recovered', 'Rate', 'Days stuck', 'Count', 'Kept', 'Broken'].includes(head[0][cell.column.index])) {
            cell.cell.styles.halign = 'right';
          }
        },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
    };

    const totalDue = analytics.weeklyCollectionRate.reduce((s, r) => s + r.dueCount, 0);
    const totalPaid = analytics.weeklyCollectionRate.reduce((s, r) => s + r.paidCount, 0);
    const collectionRate = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
    const totalKept = analytics.promiseKeptTrend.reduce((s, r) => s + r.kept, 0);
    const totalBroken = analytics.promiseKeptTrend.reduce((s, r) => s + r.broken, 0);
    const totalSent = analytics.dunningActionVolume.reduce((s, r) => s + r.sent, 0);
    const totalFailed = analytics.dunningActionVolume.reduce((s, r) => s + r.failed, 0);
    autoTable(doc, {
      startY: y,
      head: [['Collection rate', 'Promises kept / broken', 'Dunning sent / failed', 'Stuck contracts ≥14d']],
      body: [[`${collectionRate}%`, `${totalKept} / ${totalBroken}`, `${totalSent} / ${totalFailed}`, String(stuckRows.length)]],
      theme: 'plain', styles: { ...tableStyles, halign: 'center', cellWidth: (pageWidth - 86) / 4 }, margin,
      headStyles: { fillColor: [236, 245, 239], textColor: green, fontStyle: 'normal' },
      bodyStyles: { fillColor: [236, 245, 239], textColor: green, fontStyle: 'bold', fontSize: DOCUMENT_STYLE.headingPt },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

    // ---- Aging buckets ----
    if (Array.isArray(agingBuckets) && agingBuckets.length > 0) {
      table('Aging / อายุหนี้', [['Aging bucket', 'Contracts', 'Outstanding']],
        agingBuckets.map((b) => [b.bucket, String(b.count), String(b.outstanding)])
      );
    }

    // ---- Leaderboard ----
    if (Array.isArray(leaderboardRows) && leaderboardRows.length > 0) {
      table('Collectors / ผลงานเจ้าหน้าที่', [['Collector', 'Contracts', 'Collected']],
        leaderboardRows.slice(0, 10).map((row) => [
          row.name ?? '-',
          String(row.assignedCount),
          String(row.recoveryThisMonth),
        ])
      );
    }

    // ---- Recovery rate by channel ----
    if (Array.isArray(recoveryRows) && recoveryRows.length > 0) {
      table('Recovery / การชำระตามช่องทาง', [['Channel', 'Sent', 'Recovered', 'Rate']],
        recoveryRows.map((row) => [
          row.channel,
          String(row.actionsSent),
          String(row.recovered),
          // recoveryRate is already a percentage (0-100, one decimal).
          `${row.recoveryRate}%`,
        ])
      );
    }

    // ---- Letter dispatch by type ----
    if (analytics.letterDispatchByType.length > 0) {
      table('Letters / การส่งจดหมาย', [['Letter type', 'Month', 'Count']],
        analytics.letterDispatchByType.map((r) => [r.type, r.month.slice(0, 7), String(r.count)])
      );
    }

    // ---- Promise trend ----
    if (analytics.promiseKeptTrend.length > 0) {
      table('Promises / การรักษาสัญญาชำระ', [['Week', 'Kept', 'Broken']],
        analytics.promiseKeptTrend.map((r) => [
          r.weekStart.slice(0, 10),
          String(r.kept),
          String(r.broken),
        ])
      );
    }

    // ---- Stuck contracts ----
    if (stuckRows.length > 0) {
      table('Follow-up / สัญญาที่ต้องติดตาม', [['Contract #', 'Days stuck', 'Customer', 'Status']],
        stuckRows.slice(0, 20).map((row) => [
          row.contractNumber,
          String(row.daysIdle),
          row.customerName,
          row.status,
        ])
      );
    }

    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFont(font, 'bold');
      doc.setFontSize(DOCUMENT_STYLE.headingPt);
      doc.setTextColor(...green);
      doc.text('BESTCHOICE Collections Report', margin.left, 65);
      doc.setFont(font, 'normal');
      doc.setFontSize(DOCUMENT_STYLE.bodyPt);
      doc.setTextColor(...ink);
      doc.text(`Period: ${formatDate(range.from)} — ${formatDate(range.to)}`, margin.left, 89);
      doc.setDrawColor(...green);
      doc.setLineWidth(1.5);
      doc.line(margin.left, 104, pageWidth - margin.right, 104);
      doc.setDrawColor(212, 223, 217);
      doc.setLineWidth(0.5);
      doc.line(margin.left, pageHeight - 39, pageWidth - margin.right, pageHeight - 39);
      doc.setFontSize(DOCUMENT_STYLE.footerPt);
      doc.setTextColor(82, 100, 93);
      doc.text(`Generated: ${generated}`, margin.left, pageHeight - 23);
      doc.text(`${page} / ${pageCount}`, pageWidth - margin.right, pageHeight - 23, { align: 'right' });
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
