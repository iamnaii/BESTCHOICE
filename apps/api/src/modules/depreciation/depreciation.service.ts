import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { DepreciationTemplate } from '../journal/cpa-templates/depreciation.template';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly depreciationTemplate: DepreciationTemplate,
  ) {}

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
    const entries = await this.prisma.depreciationEntry.findMany({
      orderBy: { period: 'desc' },
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

  // Stubs — Tasks 10 + 12 will fill in
  async runManual(_period: string, _userId: string): Promise<DepreciationRunSummary> {
    throw new Error('runManual: implement in Task 10');
  }

  async reverseRun(
    _period: string,
    _reason: string,
    _userId: string,
  ): Promise<{ reversedCount: number }> {
    throw new Error('reverseRun: implement in Task 12');
  }
}
