import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { DepreciationTemplate } from '../journal/cpa-templates/depreciation.template';
import { DepreciationReverseTemplate } from '../journal/cpa-templates/depreciation-reverse.template';
import { validatePeriodOpen } from '../../utils/period-lock.util';

/** Maps AssetCategory → [Dr expenseCode, Cr accumulatedCode] (fallback when asset.coa* snapshots are null) */
const CATEGORY_ACCOUNT_MAP: Record<string, [string, string]> = {
  EQUIPMENT: ['53-1601', '12-2102'],
  IMPROVEMENT: ['53-1602', '12-2104'],
  FURNITURE: ['53-1603', '12-2106'],
  VEHICLE: ['53-1604', '12-2108'],
};

export interface DepreciationRunSummary {
  period: string;
  entryNumbers: string[];
  totalAmount: string;
  assetCount: number;
  ranAt: string;
  runByName: string | null;
  status: 'POSTED' | 'REVERSED';
}

export interface DepreciationPreviewLine {
  assetId: string;
  assetCode: string;
  assetName: string;
  monthlyDepr: string;
  drAccount: string;
  crAccount: string;
}

export interface DepreciationPreview {
  period: string;
  lines: DepreciationPreviewLine[];
  totalAmount: string;
  assetCount: number;
  alreadyRunForAssetIds: string[];
}

@Injectable()
export class DepreciationService {
  private readonly logger = new Logger(DepreciationService.name);
  private financeCompanyId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly depreciationTemplate: DepreciationTemplate,
    private readonly depreciationReverseTemplate: DepreciationReverseTemplate,
  ) {}

  private async getFinanceCompanyId(): Promise<string> {
    if (this.financeCompanyId) return this.financeCompanyId;
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!company) throw new Error('FINANCE company not found');
    this.financeCompanyId = company.id;
    return company.id;
  }

  /**
   * Aggregate DepreciationEntry rows by period.
   *
   * Returns one summary per period with:
   * - status: REVERSED iff every entry in the period has reversedAt set
   * - totalAmount, assetCount: aggregated across the period
   * - ranAt: earliest createdAt within the period
   * - entryNumbers: distinct journalEntryNo values seen
   */
  async listRuns(): Promise<DepreciationRunSummary[]> {
    // Cap at 5000 entries (~24 months × 200 assets) to prevent unbounded
    // growth as DepreciationEntry table grows over years of use.
    const entries = await this.prisma.depreciationEntry.findMany({
      orderBy: { period: 'desc' },
      take: 5000,
      include: {
        reversedBy: { select: { name: true } },
      },
    });

    // Group by period
    const grouped = new Map<string, typeof entries>();
    for (const e of entries) {
      const arr = grouped.get(e.period) ?? [];
      arr.push(e);
      grouped.set(e.period, arr);
    }

    const result: DepreciationRunSummary[] = [];
    for (const [period, periodEntries] of grouped) {
      const allReversed = periodEntries.every((e) => e.reversedAt !== null);
      const totalAmount = periodEntries.reduce(
        (s, e) => s.plus(e.amount.toString()),
        new Decimal(0),
      );
      const earliestRanAt = periodEntries
        .map((e) => e.createdAt)
        .reduce((a, b) => (a < b ? a : b));
      const entryNumbers = periodEntries
        .map((e) => e.journalEntryNo)
        .filter((n): n is string => !!n);
      result.push({
        period,
        entryNumbers,
        totalAmount: totalAmount.toFixed(2),
        assetCount: periodEntries.length,
        ranAt: earliestRanAt.toISOString(),
        runByName: null, // depreciation entries don't track runner; can lookup via JE.postedBy in future
        status: allReversed ? 'REVERSED' : 'POSTED',
      });
    }
    return result;
  }

  /**
   * Dry-run: returns the lines we WOULD post for the given period,
   * for every POSTED asset that doesn't already have an active (reversedAt IS NULL)
   * DepreciationEntry for that period and isn't fully depreciated.
   *
   * Prefers asset.coaExpenseAccount / asset.coaDeprAccount snapshots over
   * CATEGORY_ACCOUNT_MAP fallback (matches DepreciationTemplate routing).
   */
  async previewRun(period: string): Promise<DepreciationPreview> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException('รูปแบบงวดต้องเป็น YYYY-MM');
    }

    const assets = await this.prisma.fixedAsset.findMany({
      where: { status: 'POSTED', deletedAt: null },
    });

    const existingEntries = await this.prisma.depreciationEntry.findMany({
      where: { period, reversedAt: null },
      select: { assetId: true },
    });
    const alreadyRun = new Set(existingEntries.map((e) => e.assetId));

    const lines: DepreciationPreviewLine[] = [];
    let totalAmount = new Decimal(0);

    for (const asset of assets) {
      if (alreadyRun.has(asset.id)) continue;

      const purchaseCost = new Decimal(asset.purchaseCost.toString());
      const residualValue = new Decimal(asset.residualValue.toString());
      const accumulatedDepr = new Decimal(asset.accumulatedDepr.toString());
      const depreciableBase = purchaseCost.minus(residualValue);
      const remainingBase = depreciableBase.minus(accumulatedDepr);

      if (remainingBase.lte(0)) continue; // fully depreciated

      const monthlyDepr = new Decimal(asset.monthlyDepr.toString());
      const thisMonth = remainingBase.lt(monthlyDepr) ? remainingBase : monthlyDepr;

      const drAccount =
        asset.coaExpenseAccount ?? CATEGORY_ACCOUNT_MAP[asset.category]?.[0] ?? '53-1601';
      const crAccount =
        asset.coaDeprAccount ?? CATEGORY_ACCOUNT_MAP[asset.category]?.[1] ?? '12-2102';

      lines.push({
        assetId: asset.id,
        assetCode: asset.assetCode,
        assetName: asset.name,
        monthlyDepr: thisMonth.toFixed(2),
        drAccount,
        crAccount,
      });
      totalAmount = totalAmount.plus(thisMonth);
    }

    return {
      period,
      lines,
      totalAmount: totalAmount.toFixed(2),
      assetCount: lines.length,
      alreadyRunForAssetIds: Array.from(alreadyRun),
    };
  }

  /**
   * Manual on-demand depreciation run for a single period.
   *
   * Iterates POSTED assets (not soft-deleted, not already actively depreciated for
   * this period), invokes DepreciationTemplate per asset (idempotent — a second
   * call for the same (assetId, period) is a no-op inside the template). Aggregates
   * totals and writes a DEPRECIATION_RUN_MANUAL AuditLog on success.
   *
   * Guards:
   * 1. Period format YYYY-MM (else BadRequestException)
   * 2. Future period rejected (cannot depreciate ahead of time)
   * 3. V15 closed-period guard via validatePeriodOpen — on rejection, writes
   *    DEPRECIATION_RUN_MANUAL_BLOCKED audit + throws.
   *
   * Atomicity: the entire asset loop runs inside ONE outer $transaction so
   * partial failures roll back the whole run (per spec). Re-runs are still
   * safe because DepreciationTemplate is internally idempotent on
   * (assetId, period) — a successful re-run after a fix will simply no-op the
   * already-posted assets.
   */
  async runManual(period: string, userId: string): Promise<DepreciationRunSummary> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException('รูปแบบงวดต้องเป็น YYYY-MM');
    }

    // Reject future period (period that hasn't started yet — periodStart > today)
    // We compare periodStart so depreciation can be run for the current month
    // (tests + UX expectation: ผู้ใช้รันเดือนปัจจุบันได้ทุกวัน).
    const [y, m] = period.split('-').map(Number);
    const periodStart = new Date(y, m - 1, 1); // first day of month
    if (periodStart > new Date()) {
      throw new BadRequestException('ไม่สามารถรันค่าเสื่อมล่วงหน้า (period อยู่ในอนาคต)');
    }

    // V15 closed-period guard
    // V15 anchor: use period start so both Tier-1 (year/month) and Tier-2
    // (closed-until date) checks fail consistently when the period is closed.
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, periodStart, financeCompanyId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'period closed';
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'DEPRECIATION_RUN_MANUAL_BLOCKED',
          entity: 'depreciation_run',
          entityId: period,
          oldValue: { period },
          newValue: { reason: message },
        },
      });
      throw new BadRequestException(`ไม่สามารถรัน: ${message}`);
    }

    // Find eligible assets (POSTED, not deleted)
    const assets = await this.prisma.fixedAsset.findMany({
      where: { status: 'POSTED', deletedAt: null },
    });
    const existing = await this.prisma.depreciationEntry.findMany({
      where: { period, reversedAt: null },
      select: { assetId: true },
    });
    const alreadyRun = new Set(existing.map((e) => e.assetId));

    // Wrap whole run in single transaction for atomicity (per spec).
    // Any thrown error rolls back all posted JEs + DepreciationEntry rows
    // for this run — no partial state. Re-runs are safe (template is
    // idempotent on (assetId, period)).
    const { processedCount, entryNumbers, totalAmount, allEntriesCount } =
      await this.prisma.$transaction(async (tx) => {
        let processedCount = 0;
        const entryNumbers: string[] = [];

        for (const asset of assets) {
          if (alreadyRun.has(asset.id)) continue;
          const result = await this.depreciationTemplate.execute(
            { assetId: asset.id, period },
            tx,
          );
          if (result?.entryNo) {
            entryNumbers.push(result.entryNo);
            processedCount++;
          }
        }

        // Re-aggregate inside tx (includes pre-existing active entries
        // for this period — so re-runs report the full picture).
        const allEntries = await tx.depreciationEntry.findMany({
          where: { period, reversedAt: null },
        });
        const totalAmount = allEntries.reduce(
          (s, e) => s.plus(e.amount.toString()),
          new Decimal(0),
        );

        // Write AuditLog inside same tx so it rolls back together with JEs.
        await tx.auditLog.create({
          data: {
            userId,
            action: 'DEPRECIATION_RUN_MANUAL',
            entity: 'depreciation_run',
            entityId: period,
            oldValue: { period, alreadyRunCount: alreadyRun.size },
            newValue: {
              period,
              processedCount,
              totalAmount: totalAmount.toFixed(2),
              entryNumbers,
            },
          },
        });

        return {
          processedCount,
          entryNumbers,
          totalAmount,
          allEntriesCount: allEntries.length,
        };
      });

    this.logger.log(
      `[Phase2] DepreciationRunManual ${period} — processed ${processedCount} assets`,
    );

    return {
      period,
      entryNumbers,
      totalAmount: totalAmount.toFixed(2),
      assetCount: allEntriesCount,
      ranAt: new Date().toISOString(),
      runByName: null,
      status: 'POSTED',
    };
  }

  /**
   * Reverse all unreversed DepreciationEntry rows in the given period.
   *
   * Delegates to DepreciationReverseTemplate (cascading reverse with
   * cross-period guard, JE mirror, NBV/accum rollback). Wraps the call in
   * an outer $transaction so the AuditLog DEPRECIATION_RUN_REVERSE is atomic
   * with the reversal itself.
   *
   * Guards:
   * 1. Period regex YYYY-MM (else BadRequestException).
   * 2. Reason required (≥1 char after trim).
   * 3. V15 closed-period guard on `new Date()` — reverse JE is dated TODAY,
   *    so we check current period (not the original period). On rejection,
   *    writes DEPRECIATION_RUN_REVERSE_BLOCKED audit + throws.
   */
  async reverseRun(
    period: string,
    reason: string,
    userId: string,
  ): Promise<{ reversedCount: number; entryNumbers: string[] }> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException('รูปแบบงวดต้องเป็น YYYY-MM');
    }
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ');
    }

    // V15 on current date (reverse JE posted today)
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, new Date(), financeCompanyId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'period closed';
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'DEPRECIATION_RUN_REVERSE_BLOCKED',
          entity: 'depreciation_run',
          entityId: period,
          oldValue: { period },
          newValue: { reason: message },
        },
      });
      throw new BadRequestException(`ไม่สามารถ reverse: ${message}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.depreciationReverseTemplate.execute(
        { period, reversedById: userId, reason },
        tx,
      );

      await tx.auditLog.create({
        data: {
          userId,
          action: 'DEPRECIATION_RUN_REVERSE',
          entity: 'depreciation_run',
          entityId: period,
          oldValue: { period },
          newValue: {
            period,
            reason,
            reversedCount: result.reversedCount,
            entryNumbers: result.entryNumbers,
          },
        },
      });

      this.logger.log(
        `[Phase2] DepreciationRunReverse ${period} — reversed ${result.reversedCount} entries`,
      );

      return result;
    });
  }
}
