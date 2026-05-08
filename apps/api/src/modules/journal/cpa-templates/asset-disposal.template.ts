import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** Maps AssetCategory → [assetCostCode, accumulatedDepCode] */
const CATEGORY_ASSET_CODE_MAP: Record<string, [string, string]> = {
  EQUIPMENT: ['12-2101', '12-2102'],
  IMPROVEMENT: ['12-2103', '12-2104'],
  FURNITURE: ['12-2105', '12-2106'],
  VEHICLE: ['12-2107', '12-2108'],
};

const LOSS_ON_DISPOSAL_CODE = '53-1605'; // ขาดทุนจากการจำหน่ายสินทรัพย์
// TODO: Add dedicated gain-on-disposal income account (e.g. 41-1201 รายได้จากการจำหน่ายสินทรัพย์)
// when owner requests it. For now, gains route to 41-1102 (รายได้จากการยึดสินค้า) as closest FINANCE income.
const GAIN_ON_DISPOSAL_CODE = '41-1102'; // interim — see TODO above

export interface AssetDisposalInput {
  assetId: string;
  disposalDate: Date;
  disposalProceeds: Decimal | string | number;
  /** Cash/bank account to receive proceeds, defaults to 11-1101 */
  depositAccountCode?: string;
}

/**
 * Template — Asset disposal (Phase A.5c).
 *
 * Loss case (NBV > proceeds):
 *   Dr 12-210X+1 ค่าเสื่อมราคาสะสม       [accumulatedDepre]
 *   Dr 11-1101   เงินสด/ธนาคาร            [disposalProceeds]
 *   Dr 53-1605   ขาดทุนจากการจำหน่าย     [NBV - proceeds]
 *     Cr 12-210X สินทรัพย์               [costValue]
 *
 * Gain case (proceeds > NBV):
 *   Dr 12-210X+1 ค่าเสื่อมราคาสะสม       [accumulatedDepre]
 *   Dr 11-1101   เงินสด/ธนาคาร            [disposalProceeds]
 *     Cr 12-210X สินทรัพย์               [costValue]
 *     Cr 41-1102 รายได้ (interim)        [proceeds - NBV]
 *       ↑ TODO: replace with dedicated gain account when chart is extended
 *
 * Zero-proceeds write-off:
 *   Dr 12-210X+1 ค่าเสื่อมราคาสะสม       [accumulatedDepre]
 *   Dr 53-1605   ขาดทุนจากการจำหน่าย     [NBV]
 *     Cr 12-210X สินทรัพย์               [costValue]
 *
 * After JE: asset.status → DISPOSED, disposalDate, disposalProceeds set.
 */
@Injectable()
export class AssetDisposalTemplate {
  private readonly logger = new Logger(AssetDisposalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: AssetDisposalInput): Promise<{ entryNo: string }> {
    const { assetId, disposalDate, depositAccountCode = '11-1101' } = input;
    const proceeds = new Decimal(input.disposalProceeds.toString());

    if (proceeds.lt(0)) {
      throw new BadRequestException('disposalProceeds ต้องมีค่าตั้งแต่ 0 ขึ้นไป');
    }

    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });

    if (!asset) {
      throw new BadRequestException(`ไม่พบสินทรัพย์ id=${assetId}`);
    }

    if (asset.status === 'DISPOSED' || asset.status === 'WRITTEN_OFF') {
      throw new BadRequestException(
        `สินทรัพย์ ${asset.assetCode} ถูกจำหน่ายแล้ว (status=${asset.status})`,
      );
    }

    // Resolve asset cost/accumulated account codes from category
    const codePair = CATEGORY_ASSET_CODE_MAP[asset.category];
    if (!codePair) {
      throw new BadRequestException(
        `ไม่พบรหัสบัญชีสำหรับหมวดสินทรัพย์ ${asset.category} (asset ${asset.assetCode})`,
      );
    }
    const [assetCostCode, accumulatedCode] = codePair;

    const purchaseCost = new Decimal(asset.purchaseCost.toString());
    const accumulatedDepr = new Decimal(asset.accumulatedDepr.toString());
    const nbv = purchaseCost.minus(accumulatedDepr);
    const zero = new Decimal(0);

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [];

    // Dr: derecognize accumulated depreciation
    if (accumulatedDepr.gt(0)) {
      lines.push({
        accountCode: accumulatedCode,
        dr: accumulatedDepr,
        cr: zero,
        description: `ตัดค่าเสื่อมราคาสะสม - ${asset.name}`,
      });
    }

    // Dr: cash/bank proceeds (if any)
    if (proceeds.gt(0)) {
      lines.push({
        accountCode: depositAccountCode,
        dr: proceeds,
        cr: zero,
        description: `รับเงินจากจำหน่ายสินทรัพย์ - ${asset.name}`,
      });
    }

    // Cr: derecognize asset cost
    lines.push({
      accountCode: assetCostCode,
      dr: zero,
      cr: purchaseCost,
      description: `ตัดบัญชีสินทรัพย์ - ${asset.name}`,
    });

    // Gain or loss
    const gainOrLoss = proceeds.minus(nbv); // positive = gain, negative = loss

    if (gainOrLoss.lt(0)) {
      // Loss on disposal
      lines.push({
        accountCode: LOSS_ON_DISPOSAL_CODE,
        dr: gainOrLoss.abs(),
        cr: zero,
        description: `ขาดทุนจากการจำหน่ายสินทรัพย์ - ${asset.name}`,
      });
    } else if (gainOrLoss.gt(0)) {
      // Gain on disposal — TODO: replace 41-1102 with dedicated gain account
      lines.push({
        accountCode: GAIN_ON_DISPOSAL_CODE,
        dr: zero,
        cr: gainOrLoss,
        description: `กำไรจากการจำหน่ายสินทรัพย์ - ${asset.name} [interim: 41-1102 — TODO add dedicated gain account]`,
      });
    }
    // If gainOrLoss == 0: no extra line needed — already balanced

    const result = await this.journal.createAndPost({
      description: `จำหน่ายสินทรัพย์ ${asset.assetCode} - ${asset.name}`,
      reference: `${assetId}:disposal`,
      metadata: {
        tag: 'ASSET_DISPOSAL',
        flow: 'disposal',
        assetId,
        assetCode: asset.assetCode,
        disposalDate: disposalDate.toISOString(),
        disposalProceeds: proceeds.toFixed(2),
        nbv: nbv.toFixed(2),
        gainOrLoss: gainOrLoss.toFixed(2),
      },
      postedAt: disposalDate,
      lines,
    });

    // Update asset status (Phase 2 will refactor to capture proceeds/note in dedicated fields)
    await this.prisma.fixedAsset.update({
      where: { id: assetId },
      data: {
        status: 'DISPOSED',
        disposalDate,
        netBookValue: new Decimal(0),
      },
    });

    this.logger.log(
      `[Phase1] AssetDisposalTemplate: posted JE ${result.entryNumber} for asset ${asset.assetCode} proceeds=${proceeds.toFixed(2)} NBV=${nbv.toFixed(2)} gain/loss=${gainOrLoss.toFixed(2)}`,
    );

    return { entryNo: result.entryNumber };
  }
}
