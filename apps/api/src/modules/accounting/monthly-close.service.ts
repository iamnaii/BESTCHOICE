import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { AccountingPeriodStatus, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { TaxService } from '../tax/tax.service';
import { AccountingService } from './accounting.service';
import { PeakService } from '../peak/peak.service';

export interface PeriodStatusResult {
  companyId: string;
  year: number;
  month: number;
  status: AccountingPeriodStatus;
  reviewStartedAt: Date | null;
  reviewStartedById: string | null;
  closedAt: Date | null;
  closedById: string | null;
  peakSyncedAt: Date | null;
  peakSyncResult: unknown;
  reportSnapshot: unknown;
  auditIssues: unknown;
  notes: string | null;
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuditIssueResult {
  totalJournals: number;
  unbalancedJournals: number;
  paymentsWithoutBreakdown: number;
  hasIssues: boolean;
}

@Injectable()
export class MonthlyCloseService {
  private readonly logger = new Logger(MonthlyCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalAutoService: JournalAutoService,
    private readonly taxService: TaxService,
    private readonly accountingService: AccountingService,
    private readonly peakService: PeakService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private periodStart(year: number, month: number): Date {
    return new Date(year, month - 1, 1, 0, 0, 0, 0);
  }

  private periodEnd(year: number, month: number): Date {
    return new Date(year, month, 0, 23, 59, 59, 999);
  }

  private lastDayStr(year: number, month: number): string {
    const d = new Date(year, month, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private periodStartStr(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }

  // ─── Public Methods ───────────────────────────────────────────────────────

  /**
   * Returns the period record if it exists, or an OPEN placeholder if not.
   */
  async getPeriodStatus(companyId: string, year: number, month: number): Promise<PeriodStatusResult> {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!period) {
      return {
        companyId,
        year,
        month,
        status: 'OPEN' as AccountingPeriodStatus,
        reviewStartedAt: null,
        reviewStartedById: null,
        closedAt: null,
        closedById: null,
        peakSyncedAt: null,
        peakSyncResult: null,
        reportSnapshot: null,
        auditIssues: null,
        notes: null,
      };
    }

    return period as PeriodStatusResult;
  }

  /**
   * OPEN → REVIEW.
   * Runs a data audit: counts journals, finds unbalanced entries, counts
   * payments missing breakdown.
   */
  async startReview(
    companyId: string,
    year: number,
    month: number,
    userId: string,
  ): Promise<PeriodStatusResult> {
    const existing = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (existing && existing.status !== 'OPEN') {
      throw new BadRequestException(
        `ไม่สามารถเริ่ม Review ได้ — งวดนี้มีสถานะ ${existing.status} (ต้องการสถานะ OPEN)`,
      );
    }

    // Run data audit
    const auditIssues = await this.runDataAudit(companyId, year, month);

    const period = await this.prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId, year, month } },
      create: {
        companyId,
        year,
        month,
        status: 'REVIEW',
        reviewStartedAt: new Date(),
        reviewStartedById: userId,
        auditIssues: auditIssues as unknown as import('@prisma/client').Prisma.JsonObject,
      },
      update: {
        status: 'REVIEW',
        reviewStartedAt: new Date(),
        reviewStartedById: userId,
        auditIssues: auditIssues as unknown as import('@prisma/client').Prisma.JsonObject,
      },
    });

    this.logger.log(
      `Period ${year}/${month} (company ${companyId}) moved to REVIEW by ${userId}. ` +
      `Audit: ${JSON.stringify(auditIssues)}`,
    );

    return period as PeriodStatusResult;
  }

  /**
   * REVIEW → CLOSED.
   * Generates report snapshots: trial balance, P&L, balance sheet, VAT summary.
   */
  async closePeriod(
    companyId: string,
    year: number,
    month: number,
    userId: string,
    notes?: string,
  ): Promise<PeriodStatusResult> {
    const existing = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!existing || existing.status !== 'REVIEW') {
      const currentStatus = existing?.status ?? 'OPEN';
      throw new BadRequestException(
        `ไม่สามารถปิดงวดได้ — งวดนี้มีสถานะ ${currentStatus} (ต้องการสถานะ REVIEW)`,
      );
    }

    // Generate report snapshots
    const reportSnapshot = await this.generateReportSnapshots(companyId, year, month);

    const period = await this.prisma.accountingPeriod.update({
      where: { companyId_year_month: { companyId, year, month } },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: userId,
        reportSnapshot: reportSnapshot as unknown as import('@prisma/client').Prisma.JsonObject,
        ...(notes !== undefined ? { notes } : {}),
      },
    });

    this.logger.log(`Period ${year}/${month} (company ${companyId}) CLOSED by ${userId}.`);

    return period as PeriodStatusResult;
  }

  /**
   * CLOSED (or SYNCED) → SYNCED.
   * Checks PEAK is configured, exports journals for the period.
   */
  async syncToPeak(
    companyId: string,
    year: number,
    month: number,
  ): Promise<PeriodStatusResult> {
    const existing = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!existing || (existing.status !== 'CLOSED' && existing.status !== 'SYNCED')) {
      const currentStatus = existing?.status ?? 'OPEN';
      throw new BadRequestException(
        `ไม่สามารถ Sync ไปยัง PEAK ได้ — งวดนี้มีสถานะ ${currentStatus} (ต้องการสถานะ CLOSED หรือ SYNCED)`,
      );
    }

    if (!this.peakService.isConfigured()) {
      throw new BadRequestException('PEAK ยังไม่ได้ตั้งค่า — ต้องการ PEAK_USER_TOKEN, PEAK_CONNECT_ID, PEAK_SECRET_KEY');
    }

    const startDate = this.periodStart(year, month);
    const endDate = this.periodEnd(year, month);

    let peakSyncResult: unknown;
    try {
      peakSyncResult = await this.peakService.exportJournalEntries(startDate, endDate);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { kind: 'monthly-close-peak-sync', companyId, year: String(year), month: String(month) },
      });
      throw err;
    }

    const period = await this.prisma.accountingPeriod.update({
      where: { companyId_year_month: { companyId, year, month } },
      data: {
        status: 'SYNCED',
        peakSyncedAt: new Date(),
        peakSyncResult: peakSyncResult as unknown as import('@prisma/client').Prisma.JsonObject,
      },
    });

    this.logger.log(`Period ${year}/${month} (company ${companyId}) SYNCED to PEAK.`);

    return period as PeriodStatusResult;
  }

  /**
   * Reopen a period — resets to OPEN.
   * Cannot reopen a SYNCED period (data already exported to PEAK).
   */
  async reopenPeriod(
    companyId: string,
    year: number,
    month: number,
  ): Promise<PeriodStatusResult> {
    const existing = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!existing) {
      // Already effectively OPEN (no record exists)
      return this.getPeriodStatus(companyId, year, month);
    }

    if (existing.status === 'SYNCED') {
      throw new BadRequestException(
        'ไม่สามารถเปิดงวดใหม่ได้ — งวดนี้ถูก Sync ไปยัง PEAK แล้ว กรุณาติดต่อผู้ดูแลระบบ',
      );
    }

    const period = await this.prisma.accountingPeriod.update({
      where: { companyId_year_month: { companyId, year, month } },
      data: {
        status: 'OPEN',
        reviewStartedAt: null,
        reviewStartedById: null,
        closedAt: null,
        closedById: null,
        auditIssues: Prisma.JsonNull,
        reportSnapshot: Prisma.JsonNull,
      },
    });

    this.logger.log(`Period ${year}/${month} (company ${companyId}) reopened to OPEN.`);

    return period as PeriodStatusResult;
  }

  /**
   * Returns a 12-month overview for a given year.
   * Fills gaps (no DB record) with OPEN placeholders.
   */
  async getPeriodsOverview(
    companyId: string,
    year: number,
  ): Promise<PeriodStatusResult[]> {
    const periods = await this.prisma.accountingPeriod.findMany({
      where: { companyId, year },
      orderBy: { month: 'asc' },
    });

    const periodMap = new Map(periods.map((p) => [p.month, p]));

    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const existing = periodMap.get(month);
      if (existing) return existing as PeriodStatusResult;
      return {
        companyId,
        year,
        month,
        status: 'OPEN' as AccountingPeriodStatus,
        reviewStartedAt: null,
        reviewStartedById: null,
        closedAt: null,
        closedById: null,
        peakSyncedAt: null,
        peakSyncResult: null,
        reportSnapshot: null,
        auditIssues: null,
        notes: null,
      };
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Run audit checks for the period:
   * - Count total POSTED journal entries
   * - Find unbalanced entries (sum debit ≠ sum credit)
   * - Count payments without amount breakdown
   */
  private async runDataAudit(
    companyId: string,
    year: number,
    month: number,
  ): Promise<AuditIssueResult> {
    const startDate = this.periodStart(year, month);
    const endDate = this.periodEnd(year, month);

    // Count total journals in period
    const totalJournals = await this.prisma.journalEntry.count({
      where: {
        companyId,
        status: 'POSTED',
        entryDate: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
    });

    // Find unbalanced journal entries by grouping lines
    const journalLines = await this.prisma.journalEntry.findMany({
      where: {
        companyId,
        status: 'POSTED',
        entryDate: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
      select: {
        id: true,
        lines: {
          select: { debit: true, credit: true },
          where: { deletedAt: null },
        },
      },
    });

    let unbalancedJournals = 0;
    for (const entry of journalLines) {
      const totalDebit = entry.lines.reduce(
        (s, l) => s + Number(l.debit ?? 0),
        0,
      );
      const totalCredit = entry.lines.reduce(
        (s, l) => s + Number(l.credit ?? 0),
        0,
      );
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        unbalancedJournals++;
      }
    }

    // Count payments without breakdown (monthlyPrincipal = 0 and monthlyInterest = 0)
    const paymentsWithoutBreakdown = await this.prisma.payment.count({
      where: {
        status: 'PAID',
        paidDate: { gte: startDate, lte: endDate },
        deletedAt: null,
        monthlyPrincipal: { equals: null },
        contract: {
          deletedAt: null,
          branch: { companyId },
        },
      },
    });

    return {
      totalJournals,
      unbalancedJournals,
      paymentsWithoutBreakdown,
      hasIssues: unbalancedJournals > 0 || paymentsWithoutBreakdown > 0,
    };
  }

  /**
   * Generate report snapshots: trial balance, P&L, balance sheet, VAT summary.
   * Results are stored as JSON in reportSnapshot.
   */
  private async generateReportSnapshots(
    companyId: string,
    year: number,
    month: number,
  ): Promise<Record<string, unknown>> {
    const asOfDate = this.lastDayStr(year, month);
    const startDate = this.periodStartStr(year, month);

    // Get branch IDs for this company
    const branchIds = await this.accountingService.getBranchIdsForCompany(companyId);

    const [trialBalance, profitLoss, balanceSheet, vatSummary] = await Promise.allSettled([
      this.journalAutoService.getTrialBalance({ asOfDate, companyId }),
      this.accountingService.getProfitLossReport(startDate, asOfDate, undefined, branchIds),
      this.accountingService.getBalanceSheet(asOfDate, undefined, branchIds),
      this.taxService.previewPP30(companyId, year, month),
    ]);

    const snapshot: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      year,
      month,
      companyId,
    };

    if (trialBalance.status === 'fulfilled') {
      snapshot.trialBalance = trialBalance.value;
    } else {
      snapshot.trialBalanceError = (trialBalance.reason as Error)?.message;
      this.logger.warn(`Trial balance failed for ${year}/${month}: ${(trialBalance.reason as Error)?.message}`);
    }

    if (profitLoss.status === 'fulfilled') {
      snapshot.profitLoss = profitLoss.value;
    } else {
      snapshot.profitLossError = (profitLoss.reason as Error)?.message;
      this.logger.warn(`P&L failed for ${year}/${month}: ${(profitLoss.reason as Error)?.message}`);
    }

    if (balanceSheet.status === 'fulfilled') {
      snapshot.balanceSheet = balanceSheet.value;
    } else {
      snapshot.balanceSheetError = (balanceSheet.reason as Error)?.message;
      this.logger.warn(`Balance sheet failed for ${year}/${month}: ${(balanceSheet.reason as Error)?.message}`);
    }

    if (vatSummary.status === 'fulfilled') {
      snapshot.vatSummary = vatSummary.value;
    } else {
      snapshot.vatSummaryError = (vatSummary.reason as Error)?.message;
      this.logger.warn(`VAT summary failed for ${year}/${month}: ${(vatSummary.reason as Error)?.message}`);
    }

    return snapshot;
  }
}
