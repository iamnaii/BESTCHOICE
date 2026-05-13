import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccountingPeriodStatus, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { d, dSum, dClose } from '../../utils/decimal.util';
import { JournalAutoService } from '../journal/journal-auto.service';
import { TaxService } from '../tax/tax.service';
import { AccountingService } from './accounting.service';
import { PeakService } from '../peak/peak.service';
import { AuditService } from '../audit/audit.service';
import { ReopenPeriodDto } from './dto/reopen-period.dto';

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
    private readonly auditService: AuditService,
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
   *
   * F-6-003 — Hard-blocks close when `existing.auditIssues.hasIssues=true`
   * unless OWNER supplies `forceCloseReason` (≥50 chars, validated by DTO).
   * Force close writes an AuditLog `PERIOD_FORCE_CLOSE` capturing the
   * reason + the issues acknowledged at the time of close.
   */
  async closePeriod(
    companyId: string,
    year: number,
    month: number,
    userId: string,
    notes?: string,
    forceCloseReason?: string,
    userRole?: string,
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

    // F-6-003 — enforce auditIssues unless OWNER provides forceCloseReason
    const issues = (existing.auditIssues as { hasIssues?: boolean } | null) ?? null;
    const hasIssues = issues?.hasIssues === true;
    if (hasIssues && !forceCloseReason) {
      throw new BadRequestException({
        message:
          'พบ issue ในงวดนี้ ต้องแก้ก่อนปิด หรือใส่ forceCloseReason (≥50 ตัวอักษร) เพื่อ override (OWNER เท่านั้น)',
        issues,
      });
    }

    // F-6-003 hardening — forceCloseReason override is OWNER-only.
    // Controller @Roles allows FINANCE_MANAGER for normal close, but the
    // override path that bypasses auditIssues must be restricted to OWNER.
    if (forceCloseReason && userRole !== 'OWNER') {
      throw new ForbiddenException(
        'เฉพาะ OWNER เท่านั้นที่ใช้ forceCloseReason override ได้',
      );
    }

    // Generate report snapshots
    const reportSnapshot = await this.generateReportSnapshots(companyId, year, month);

    const period = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.accountingPeriod.update({
        where: { companyId_year_month: { companyId, year, month } },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: userId,
          reportSnapshot: reportSnapshot as unknown as import('@prisma/client').Prisma.JsonObject,
          ...(notes !== undefined ? { notes } : {}),
        },
      });

      if (forceCloseReason) {
        await tx.auditLog.create({
          data: {
            userId,
            action: 'PERIOD_FORCE_CLOSE',
            entity: 'accounting_period',
            entityId: existing.id,
            newValue: {
              reason: forceCloseReason,
              issues: existing.auditIssues,
              period: `${existing.year}-${String(existing.month).padStart(2, '0')}`,
            } as unknown as import('@prisma/client').Prisma.JsonObject,
          },
        });
      }

      return updated;
    });

    this.logger.log(
      `Period ${year}/${month} (company ${companyId}) CLOSED by ${userId}.` +
        (forceCloseReason ? ' [FORCE_CLOSE]' : ''),
    );

    // Emit PERIOD_CLOSED audit outside transaction — best-effort, don't roll back on failure.
    try {
      await this.auditService.log({
        userId,
        action: 'PERIOD_CLOSED',
        entity: 'accounting_period',
        entityId: existing.id,
        newValue: {
          closedAt: period.closedAt?.toISOString() ?? new Date().toISOString(),
          period: `${year}-${String(month).padStart(2, '0')}`,
          forceClose: !!forceCloseReason,
        },
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { module: 'accounting', action: 'PERIOD_CLOSED' },
        extra: { companyId, year, month, userId },
      });
    }

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
   *
   * T2-C10 — 90-day lock:
   *   A CLOSED period older than 90 days (measured from `closedAt`) may only
   *   be reopened with an explicit `boardResolutionId` string. Without it the
   *   operation throws ForbiddenException — requires Board approval because
   *   a stale reopen can rewrite reported P&L / tax filings after the fact.
   *   OWNER-only is already enforced at the controller level.
   *
   * F-6-004 — Persists `reopenedAt`, `reopenedById`, `boardResolutionId`
   * on the AccountingPeriod row and creates an AuditLog `PERIOD_REOPEN`
   * record capturing reason + board resolution. DTO requires both
   * `boardResolutionId` and `reason` (≥20 chars).
   */
  async reopenPeriod(
    dto: ReopenPeriodDto,
    userId: string,
    ipAddress?: string,
  ): Promise<PeriodStatusResult> {
    const { companyId, year, month, boardResolutionId, reasonType, reason, taxFiled } = dto;

    // Format compound reason string for storage
    const reopenReason = `${reasonType}: ${reason}`;

    // Pre-flight checks: read current state once, validate before entering CAS loop.
    const existing = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!existing) {
      // Already effectively OPEN (no record exists) — nothing to reopen.
      return this.getPeriodStatus(companyId, year, month);
    }

    if (existing.status === 'SYNCED') {
      throw new BadRequestException(
        'ไม่สามารถเปิดงวดใหม่ได้ — งวดนี้ถูก Sync ไปยัง PEAK แล้ว กรุณาติดต่อผู้ดูแลระบบ',
      );
    }

    // T2-C10 — 90-day lock on stale CLOSED periods. boardResolutionId is now
    // always required by DTO, but we still keep the explicit check for clarity
    // (and to surface the Forbidden message rather than a generic validation
    // error if the DTO is bypassed by an internal caller).
    if (existing.status === 'CLOSED' && existing.closedAt) {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const isStale = existing.closedAt < ninetyDaysAgo;
      const hasBoardResolution =
        typeof boardResolutionId === 'string' && boardResolutionId.trim().length > 0;
      if (isStale && !hasBoardResolution) {
        throw new ForbiddenException(
          'งวดนี้ถูกปิดเกิน 90 วัน จึงล็อกอัตโนมัติ ต้องใช้มติบอร์ด (boardResolutionId) เพื่อเปิดงวดใหม่',
        );
      }
    }

    // CAS via updateMany — only succeeds if the row is still CLOSED at update time.
    // This prevents 2 concurrent OWNER requests from both passing the pre-flight
    // check and both committing the reopen (TOCTOU race).
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.accountingPeriod.updateMany({
        where: {
          companyId,
          year,
          month,
          status: 'CLOSED', // CAS guard — only matches if still CLOSED
        },
        data: {
          status: 'OPEN',
          reviewStartedAt: null,
          reviewStartedById: null,
          closedAt: null,
          closedById: null,
          auditIssues: Prisma.JsonNull,
          reportSnapshot: Prisma.JsonNull,
          reopenedAt: new Date(),
          reopenedById: userId,
          boardResolutionId: boardResolutionId ?? null,
          reopenReason,
          taxFiled,
        },
      });

      if (result.count === 0) {
        // CAS miss: re-read to give a precise error message.
        const current = await tx.accountingPeriod.findUnique({
          where: { companyId_year_month: { companyId, year, month } },
        });
        if (!current) {
          throw new NotFoundException('ไม่พบงวดบัญชี');
        }
        if (current.status === 'OPEN') {
          throw new BadRequestException('งวดนี้ยังเปิดอยู่ ไม่จำเป็นต้องเปิดซ้ำ');
        }
        throw new ConflictException(
          `งวด ${year}-${String(month).padStart(2, '0')} ถูกแก้ไขโดยผู้ใช้คนอื่นพร้อมกัน — กรุณาลองใหม่`,
        );
      }

      // Refetch the updated row so callers get the full record.
      return tx.accountingPeriod.findUnique({
        where: { companyId_year_month: { companyId, year, month } },
      });
    });

    this.logger.log(
      `Period ${year}/${month} (company ${companyId}) reopened to OPEN by ${userId} ` +
        `(reasonType=${reasonType}, taxFiled=${taxFiled}).`,
    );

    // Emit PERIOD_REOPENED audit OUTSIDE transaction — matches JV_OVERRIDDEN pattern;
    // AuditService hash-chain is incompatible with nested $transaction.
    try {
      await this.auditService.log({
        userId,
        action: 'PERIOD_REOPENED',
        entity: 'accounting_period',
        entityId: existing.id,
        newValue: {
          reasonType,
          reason,
          taxFiled,
          reopenedAt: updated?.reopenedAt?.toISOString(),
          period: `${existing.year}-${String(existing.month).padStart(2, '0')}`,
          previousStatus: existing.status,
          boardResolutionId: boardResolutionId ?? null,
        },
        ipAddress,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { module: 'accounting', action: 'PERIOD_REOPENED' },
        extra: { companyId, year, month, userId },
      });
    }

    return updated as PeriodStatusResult;
  }

  /**
   * Returns all currently reopened periods (status = OPEN with reopenedAt set).
   * Ordered by year/month descending.
   */
  async listReopenedPeriods() {
    return this.prisma.accountingPeriod.findMany({
      where: {
        reopenedAt: { not: null },
        status: 'OPEN',
      },
      include: {
        reopenedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
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
      const totalDebit = dSum(entry.lines.map((l) => d(l.debit)));
      const totalCredit = dSum(entry.lines.map((l) => d(l.credit)));
      if (!dClose(totalDebit, totalCredit)) {
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
      this.accountingService.getTrialBalance(new Date(asOfDate)),
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
