import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** Maps AssetCategory → [Dr expenseCode, Cr accumulatedCode] */
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
 * Category → account mapping:
 *   EQUIPMENT:   Dr 53-1601 / Cr 12-2102
 *   IMPROVEMENT: Dr 53-1602 / Cr 12-2104
 *   FURNITURE:   Dr 53-1603 / Cr 12-2106
 *   VEHICLE:     Dr 53-1604 / Cr 12-2108
 *
 * Idempotent: second call for same (assetId, period) returns the same JE.
 * Guards: POSTED status only, not fully depreciated.
 */
@Injectable()
export class DepreciationTemplate {
  private readonly logger = new Logger(DepreciationTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: DepreciationTemplateInput): Promise<{ entryNo: string } | null> {
    const { assetId, period } = input;

    const asset = await this.prisma.fixedAsset.findFirst({
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

    // Idempotency: check DepreciationEntry
    const existing = await this.prisma.depreciationEntry.findUnique({
      where: { assetId_period: { assetId, period } },
    });
    if (existing) {
      this.logger.log(
        `[Phase1] DepreciationTemplate idempotency — entry already exists for asset ${asset.assetCode} period ${period}`,
      );
      return existing.journalEntryNo ? { entryNo: existing.journalEntryNo } : null;
    }

    // Resolve account codes by category
    const [drCode, crCode] = CATEGORY_ACCOUNT_MAP[asset.category];

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

    const monthlyAmount = depreciableBase.div(lifeMonths).toDecimalPlaces(2);
    // Final partial month: cap to remaining
    const actualAmount = monthlyAmount.gt(remainingBase) ? remainingBase : monthlyAmount;

    const categoryLabel = CATEGORY_LABEL[asset.category] ?? 'สินทรัพย์';

    const zero = new Decimal(0);

    const result = await this.journal.createAndPost({
      description: `ค่าเสื่อมราคา ${asset.name} (${categoryLabel}) ประจำงวด ${period}`,
      reference: `${assetId}:depreciation:${period}`,
      metadata: {
        tag: 'DEPRECIATION',
        flow: 'monthly',
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
    });

    // Record DepreciationEntry (idempotency guard)
    await this.prisma.depreciationEntry.create({
      data: {
        assetId,
        period,
        amount: actualAmount,
        journalEntryNo: result.entryNumber,
      },
    });

    // Update asset accumulated depreciation + netBookValue.
    // Phase 1 schema does not have a `lastDepreciationPeriod` or FULLY_DEPRECIATED status —
    // fully-depreciated state is implied by `accumulatedDepr >= (purchaseCost - residualValue)`.
    const newAccumulated = accumulatedDepr.plus(actualAmount);
    const newNetBookValue = purchaseCost.minus(newAccumulated);

    await this.prisma.fixedAsset.update({
      where: { id: assetId },
      data: {
        accumulatedDepr: newAccumulated,
        netBookValue: newNetBookValue,
      },
    });

    this.logger.log(
      `[Phase1] DepreciationTemplate: posted JE ${result.entryNumber} for asset ${asset.assetCode} period ${period} amount ${actualAmount.toFixed(2)}`,
    );

    return { entryNo: result.entryNumber };
  }
}
