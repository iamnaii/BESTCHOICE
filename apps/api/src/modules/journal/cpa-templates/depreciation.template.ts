import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** Maps AssetCategory → [Dr expenseCode, Cr accumulatedCode] */
const CATEGORY_ACCOUNT_MAP: Record<string, [string, string]> = {
  OFFICE_EQUIPMENT: ['53-1601', '12-2102'],
  BUILDING_IMPROVEMENT: ['53-1602', '12-2104'],
  OFFICE_FURNITURE: ['53-1603', '12-2106'],
  VEHICLE: ['53-1604', '12-2108'],
};

const CATEGORY_LABEL: Record<string, string> = {
  OFFICE_EQUIPMENT: 'อุปกรณ์สำนักงาน',
  BUILDING_IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  OFFICE_FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

export interface DepreciationTemplateInput {
  assetId: string;
  /** Period in "YYYY-MM" format, e.g. "2026-04" */
  period: string;
}

/**
 * Template — Monthly straight-line depreciation (Phase A.5c).
 *
 * JE per asset:
 *   Dr 53-160X ค่าเสื่อมราคา - <category>         [monthlyAmount]
 *     Cr 12-210X ค่าเสื่อมราคาสะสม - <category>   [monthlyAmount]
 *
 * Category → account mapping:
 *   OFFICE_EQUIPMENT:     Dr 53-1601 / Cr 12-2102
 *   BUILDING_IMPROVEMENT: Dr 53-1602 / Cr 12-2104
 *   OFFICE_FURNITURE:     Dr 53-1603 / Cr 12-2106
 *   VEHICLE:              Dr 53-1604 / Cr 12-2108
 *
 * Idempotent: second call for same (assetId, period) returns null.
 * Guards: ACTIVE status only, not fully depreciated.
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
      this.logger.warn(`[A.5c] DepreciationTemplate: asset ${assetId} not found`);
      return null;
    }

    if (asset.status !== 'ACTIVE') {
      this.logger.log(
        `[A.5c] DepreciationTemplate: asset ${asset.assetCode} status=${asset.status} — skipping`,
      );
      return null;
    }

    // Idempotency: check DepreciationEntry
    const existing = await this.prisma.depreciationEntry.findUnique({
      where: { assetId_period: { assetId, period } },
    });
    if (existing) {
      this.logger.log(
        `[A.5c] DepreciationTemplate idempotency — entry already exists for asset ${asset.assetCode} period ${period}`,
      );
      return existing.journalEntryNo ? { entryNo: existing.journalEntryNo } : null;
    }

    // Resolve account codes: prefer explicit codes, fall back to assetCategory enum
    let drCode: string;
    let crCode: string;

    if (asset.assetCategory && CATEGORY_ACCOUNT_MAP[asset.assetCategory]) {
      [drCode, crCode] = CATEGORY_ACCOUNT_MAP[asset.assetCategory];
    } else {
      // Fall back to asset's stored account codes (legacy assets without assetCategory)
      drCode = asset.depreciationAccountCode;
      crCode = asset.accumulatedAccountCode;
    }

    // Compute monthly depreciation
    const costValue = new Decimal(asset.costValue.toString());
    const salvageValue = new Decimal(asset.salvageValue.toString());
    const accumulatedDepre = new Decimal(asset.accumulatedDepre.toString());
    const depreciableBase = costValue.minus(salvageValue);
    const remainingBase = depreciableBase.minus(accumulatedDepre);

    if (remainingBase.lte(0)) {
      this.logger.log(
        `[A.5c] DepreciationTemplate: asset ${asset.assetCode} fully depreciated — skipping`,
      );
      return null;
    }

    // usefulLifeMonths takes precedence over usefulLife (years)
    const lifeMonths = asset.usefulLifeMonths ?? asset.usefulLife * 12;
    if (lifeMonths <= 0) {
      this.logger.warn(
        `[A.5c] DepreciationTemplate: asset ${asset.assetCode} usefulLifeMonths=${lifeMonths} invalid — skipping`,
      );
      return null;
    }

    const monthlyAmount = depreciableBase.div(lifeMonths).toDecimalPlaces(2);
    // Final partial month: cap to remaining
    const actualAmount = monthlyAmount.gt(remainingBase) ? remainingBase : monthlyAmount;

    const categoryLabel =
      (asset.assetCategory && CATEGORY_LABEL[asset.assetCategory]) ?? 'สินทรัพย์';

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
        category: asset.assetCategory ?? 'LEGACY',
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

    // Update asset accumulated depreciation + lastDepreciationPeriod
    const newAccumulated = accumulatedDepre.plus(actualAmount);
    const isFullyDepreciated = newAccumulated.gte(depreciableBase);

    await this.prisma.fixedAsset.update({
      where: { id: assetId },
      data: {
        accumulatedDepre: newAccumulated,
        lastDepreciationPeriod: period,
        status: isFullyDepreciated ? 'FULLY_DEPRECIATED' : 'ACTIVE',
      },
    });

    this.logger.log(
      `[A.5c] DepreciationTemplate: posted JE ${result.entryNumber} for asset ${asset.assetCode} period ${period} amount ${actualAmount.toFixed(2)}`,
    );

    return { entryNo: result.entryNumber };
  }
}
