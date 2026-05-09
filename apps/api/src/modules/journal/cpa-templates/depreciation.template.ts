import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** Maps AssetCategory → [Dr expenseCode, Cr accumulatedCode] (fallback when asset.coa* snapshots are null) */
const CATEGORY_ACCOUNT_MAP: Record<string, [string, string]> = {
  EQUIPMENT: ['53-1601', '12-2102'],
  IMPROVEMENT: ['53-1602', '12-2104'],
  FURNITURE: ['53-1603', '12-2106'],
  VEHICLE: ['53-1604', '12-2108'],
};

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

export interface DepreciationTemplateInput {
  assetId: string;
  /** Period in "YYYY-MM" format, e.g. "2026-04" */
  period: string;
}

/**
 * Template — Monthly straight-line depreciation (Phase 1).
 *
 * JE per asset:
 *   Dr 53-160X ค่าเสื่อมราคา - <category>         [monthlyAmount]
 *     Cr 12-210X ค่าเสื่อมราคาสะสม - <category>   [monthlyAmount]
 *
 * Account routing (in order of precedence):
 *   1. asset.coaExpenseAccount / asset.coaDeprAccount snapshots (set at POST time)
 *   2. CATEGORY_ACCOUNT_MAP fallback (legacy assets pre-snapshot)
 *
 * Idempotent: second call for same (assetId, period) returns the same JE — the
 * idempotency check runs INSIDE the outer $transaction (TOCTOU-safe).
 *
 * Atomicity: idempotency check + JE post + DepreciationEntry insert + asset
 * update run inside ONE $transaction. When the caller passes outerTx, we run
 * inside their transaction (no nested $transaction).
 *
 * Rounding: monthly depreciation uses ROUND_DOWN (per accounting.md) — same
 * convention as gross/12 in installment accruals.
 *
 * Guards: POSTED status only, not fully depreciated.
 */
@Injectable()
export class DepreciationTemplate {
  private readonly logger = new Logger(DepreciationTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: DepreciationTemplateInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    const { assetId, period } = input;

    const reader = (outerTx ?? this.prisma) as Prisma.TransactionClient;

    const asset = await reader.fixedAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });

    if (!asset) {
      this.logger.warn(`[Phase1] DepreciationTemplate: asset ${assetId} not found`);
      return null;
    }

    if (asset.status !== 'POSTED') {
      this.logger.log(
        `[Phase1] DepreciationTemplate: asset ${asset.assetCode} status=${asset.status} — skipping`,
      );
      return null;
    }

    // Compute monthly depreciation
    const purchaseCost = new Decimal(asset.purchaseCost.toString());
    const residualValue = new Decimal(asset.residualValue.toString());
    const accumulatedDepr = new Decimal(asset.accumulatedDepr.toString());
    const depreciableBase = purchaseCost.minus(residualValue);
    const remainingBase = depreciableBase.minus(accumulatedDepr);

    if (remainingBase.lte(0)) {
      this.logger.log(
        `[Phase1] DepreciationTemplate: asset ${asset.assetCode} fully depreciated — skipping`,
      );
      return null;
    }

    const lifeMonths = asset.usefulLifeMonths;
    if (lifeMonths <= 0) {
      this.logger.warn(
        `[Phase1] DepreciationTemplate: asset ${asset.assetCode} usefulLifeMonths=${lifeMonths} invalid — skipping`,
      );
      return null;
    }

    // ROUND_DOWN per accounting.md (matches installment accrual gross/12 convention).
    const monthlyAmount = depreciableBase.div(lifeMonths).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    // Final partial month: cap to remaining
    const actualAmount = monthlyAmount.gt(remainingBase) ? remainingBase : monthlyAmount;

    // Resolve account codes — prefer asset.coa* snapshots (pinned at POST time)
    // over CATEGORY_ACCOUNT_MAP. Defensive fallback for legacy/test assets that
    // were POSTED before the snapshot logic landed.
    const fallback = CATEGORY_ACCOUNT_MAP[asset.category];
    const drCode = asset.coaExpenseAccount ?? fallback?.[0];
    const crCode = asset.coaDeprAccount ?? fallback?.[1];
    if (!drCode || !crCode) {
      this.logger.warn(
        `[Phase1] DepreciationTemplate: cannot resolve dr/cr code for asset ${asset.assetCode} (category=${asset.category})`,
      );
      return null;
    }

    const categoryLabel = CATEGORY_LABEL[asset.category] ?? 'สินทรัพย์';
    const zero = new Decimal(0);

    // Atomic block: idempotency + JE post + DepreciationEntry insert + asset update
    // all run inside ONE transaction (TOCTOU-safe and no orphan state).
    const run = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string } | null> => {
      // Idempotency: query DepreciationEntry inside tx
      const existing = await tx.depreciationEntry.findUnique({
        where: { assetId_period: { assetId, period } },
      });
      if (existing) {
        this.logger.log(
          `[Phase1] DepreciationTemplate idempotency — entry already exists for asset ${asset.assetCode} period ${period}`,
        );
        return existing.journalEntryNo ? { entryNo: existing.journalEntryNo } : null;
      }

      const result = await this.journal.createAndPost(
        {
          description: `ค่าเสื่อมราคา ${asset.name} (${categoryLabel}) ประจำงวด ${period}`,
          reference: `${assetId}:depreciation:${period}`,
          metadata: {
            tag: 'DEPRECIATION',
            flow: 'depreciation',
            assetId,
            assetCode: asset.assetCode,
            period,
            category: asset.category,
          },
          lines: [
            {
              accountCode: drCode,
              dr: actualAmount,
              cr: zero,
              description: `ค่าเสื่อมราคา - ${asset.name} (${period})`,
            },
            {
              accountCode: crCode,
              dr: zero,
              cr: actualAmount,
              description: `ค่าเสื่อมราคาสะสม - ${asset.name} (${period})`,
            },
          ],
        },
        tx,
      );

      // Record DepreciationEntry (idempotency guard) — inside same tx.
      await tx.depreciationEntry.create({
        data: {
          assetId,
          period,
          amount: actualAmount,
          journalEntryNo: result.entryNumber,
        },
      });

      // Update asset accumulated depreciation + netBookValue — inside same tx.
      // Phase 1 schema does not have a `lastDepreciationPeriod` or FULLY_DEPRECIATED status —
      // fully-depreciated state is implied by `accumulatedDepr >= (purchaseCost - residualValue)`.
      const newAccumulated = accumulatedDepr.plus(actualAmount);
      const newNetBookValue = purchaseCost.minus(newAccumulated);

      await tx.fixedAsset.update({
        where: { id: assetId },
        data: {
          accumulatedDepr: newAccumulated,
          netBookValue: newNetBookValue,
        },
      });

      return { entryNo: result.entryNumber };
    };

    const out = outerTx
      ? await run(outerTx)
      : await this.prisma.$transaction(run);

    if (out) {
      this.logger.log(
        `[Phase1] DepreciationTemplate: posted JE ${out.entryNo} for asset ${asset.assetCode} period ${period} amount ${actualAmount.toFixed(2)}`,
      );
    }

    return out;
  }
}
