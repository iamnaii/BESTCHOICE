import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** Maps AssetCategory → [assetCostCode, accumulatedDepCode] (fallback when asset.coa* snapshots are null) */
const CATEGORY_ASSET_CODE_MAP: Record<string, [string, string]> = {
  EQUIPMENT: ['12-2101', '12-2102'],
  IMPROVEMENT: ['12-2103', '12-2104'],
  FURNITURE: ['12-2105', '12-2106'],
  VEHICLE: ['12-2107', '12-2108'],
};

const LOSS_ON_DISPOSAL_CODE = '53-1605'; // ขาดทุนจากการจำหน่ายสินทรัพย์
const GAIN_ON_DISPOSAL_CODE = '42-1105'; // กำไรจากการจำหน่ายสินทรัพย์ (FINANCE chart, Phase A.5c)
const VAT_OUTPUT_CODE = '21-2101'; // ภาษีขาย ภ.พ.30
const VAT_RATE = new Decimal('0.07');

export interface AssetDisposalInput {
  assetId: string;
  disposalDate: Date;
  /** Sale price excluding VAT (ม.77/1 — base for VAT 7% if issuing tax invoice) */
  disposalProceeds: Decimal | string | number;
  /** Cash/bank account to receive proceeds, defaults to 11-1101 */
  depositAccountCode?: string;
  /**
   * ออกใบกำกับภาษีให้ผู้ซื้อ (CRITICAL #3 fix · 2569-05-09).
   * Per ม.77/1 + ม.82 — การขายสินทรัพย์ถาวรของผู้จด VAT อยู่ในข่าย VAT 7%.
   * When true: posts Cr 21-2101 (VAT 7% × proceeds), buyer pays proceeds × 1.07.
   * When false/undefined: no VAT line (legal only when buyer doesn't request tax invoice).
   */
  issueTaxInvoice?: boolean;
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
 *     Cr 42-1105 กำไรจากการจำหน่าย       [proceeds - NBV]
 *
 * Zero-proceeds write-off:
 *   Dr 12-210X+1 ค่าเสื่อมราคาสะสม       [accumulatedDepre]
 *   Dr 53-1605   ขาดทุนจากการจำหน่าย     [NBV]
 *     Cr 12-210X สินทรัพย์               [costValue]
 *
 * Account routing (in order of precedence):
 *   1. asset.coaCostAccount / asset.coaDeprAccount snapshots (set at POST time)
 *   2. CATEGORY_ASSET_CODE_MAP fallback
 *
 * Idempotent: second call for the same assetId returns the same JE — the
 * idempotency check runs INSIDE the outer $transaction (TOCTOU-safe).
 *
 * Atomicity: idempotency check + JE post + asset update run inside ONE
 * $transaction. When the caller passes outerTx, we run inside their
 * transaction (no nested $transaction).
 *
 * After JE: asset.status → DISPOSED, disposalDate set, netBookValue=0.
 */
@Injectable()
export class AssetDisposalTemplate {
  private readonly logger = new Logger(AssetDisposalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: AssetDisposalInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const {
      assetId,
      disposalDate,
      depositAccountCode = '11-1101',
      issueTaxInvoice = false,
    } = input;
    const proceeds = new Decimal(input.disposalProceeds.toString());

    if (proceeds.lt(0)) {
      throw new BadRequestException('disposalProceeds ต้องมีค่าตั้งแต่ 0 ขึ้นไป');
    }

    if (issueTaxInvoice && proceeds.lte(0)) {
      throw new BadRequestException(
        'ไม่สามารถออกใบกำกับภาษีเมื่อ proceeds = 0 (write-off / ทิ้งเครื่อง ไม่มีการขาย)',
      );
    }

    // VAT 7% on sale proceeds (CRITICAL #3 fix · ม.77/1 + ม.82).
    // VAT is only added when issueTaxInvoice = true. Cash received from buyer
    // includes VAT (proceeds × 1.07). VAT is remitted via 21-2101.
    // ROUND_HALF_UP per accounting.md VAT convention (matches per-installment vatPerInst).
    const vatOnSale = issueTaxInvoice
      ? proceeds.times(VAT_RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal(0);
    const totalCashReceived = proceeds.plus(vatOnSale);

    const reader = (outerTx ?? this.prisma) as Prisma.TransactionClient;

    const asset = await reader.fixedAsset.findFirst({
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

    // Resolve asset cost / accumulated codes — prefer asset.coa* snapshots.
    const fallback = CATEGORY_ASSET_CODE_MAP[asset.category];
    const assetCostCode = asset.coaCostAccount ?? fallback?.[0];
    const accumulatedCode = asset.coaDeprAccount ?? fallback?.[1];
    if (!assetCostCode || !accumulatedCode) {
      throw new BadRequestException(
        `ไม่พบรหัสบัญชีสำหรับหมวดสินทรัพย์ ${asset.category} (asset ${asset.assetCode})`,
      );
    }

    const purchaseCost = new Decimal(asset.purchaseCost.toString());
    const accumulatedDepr = new Decimal(asset.accumulatedDepr.toString());
    const nbv = purchaseCost.minus(accumulatedDepr);
    const zero = new Decimal(0);

    type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
    const lines: Line[] = [];

    // Dr: derecognize accumulated depreciation
    if (accumulatedDepr.gt(0)) {
      lines.push({
        accountCode: accumulatedCode,
        dr: accumulatedDepr,
        cr: zero,
        description: `ตัดค่าเสื่อมราคาสะสม - ${asset.name}`,
      });
    }

    // Dr: cash/bank proceeds (proceeds + VAT if issuing tax invoice)
    if (totalCashReceived.gt(0)) {
      lines.push({
        accountCode: depositAccountCode,
        dr: totalCashReceived,
        cr: zero,
        description: issueTaxInvoice
          ? `รับเงินจากจำหน่ายสินทรัพย์ (รวม VAT) - ${asset.name}`
          : `รับเงินจากจำหน่ายสินทรัพย์ - ${asset.name}`,
      });
    }

    // Cr: derecognize asset cost
    lines.push({
      accountCode: assetCostCode,
      dr: zero,
      cr: purchaseCost,
      description: `ตัดบัญชีสินทรัพย์ - ${asset.name}`,
    });

    // Cr: VAT output (CRITICAL #3 — ม.77/1 + ม.82)
    if (vatOnSale.gt(0)) {
      lines.push({
        accountCode: VAT_OUTPUT_CODE,
        dr: zero,
        cr: vatOnSale,
        description: `ภาษีขาย ภ.พ.30 (จำหน่ายสินทรัพย์) - ${asset.name}`,
      });
    }

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
      // Gain on disposal — 42-1105 (FINANCE chart, Phase A.5c)
      lines.push({
        accountCode: GAIN_ON_DISPOSAL_CODE,
        dr: zero,
        cr: gainOrLoss,
        description: `กำไรจากการจำหน่ายสินทรัพย์ - ${asset.name}`,
      });
    }
    // If gainOrLoss == 0: no extra line needed — already balanced

    // Atomic block: idempotency + JE post + asset update inside ONE $transaction.
    const run = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      // Idempotency check — TOCTOU-safe inside the tx
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'asset-disposal' } as any },
            { metadata: { path: ['assetId'], equals: assetId } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `[Phase1] AssetDisposalTemplate idempotency — JE ${existing.entryNumber} already exists for asset ${assetId}, skipping`,
        );
        return { entryNo: existing.entryNumber };
      }

      const result = await this.journal.createAndPost(
        {
          description: `จำหน่ายสินทรัพย์ ${asset.assetCode} - ${asset.name}`,
          reference: `${assetId}:disposal`,
          metadata: {
            tag: 'ASSET_DISPOSAL',
            flow: 'asset-disposal',
            assetId,
            assetCode: asset.assetCode,
            disposalDate: disposalDate.toISOString(),
            disposalProceeds: proceeds.toFixed(2),
            nbv: nbv.toFixed(2),
            gainOrLoss: gainOrLoss.toFixed(2),
            issueTaxInvoice,
            vatOnSale: vatOnSale.toFixed(2),
            totalCashReceived: totalCashReceived.toFixed(2),
          },
          postedAt: disposalDate,
          lines,
        },
        tx,
      );

      // Update asset status (Phase 2 will refactor to capture proceeds/note in dedicated fields)
      await tx.fixedAsset.update({
        where: { id: assetId },
        data: {
          status: 'DISPOSED',
          disposalDate,
          netBookValue: new Decimal(0),
        },
      });

      return { entryNo: result.entryNumber };
    };

    const out = outerTx
      ? await run(outerTx)
      : await this.prisma.$transaction(run);

    this.logger.log(
      `[Phase1] AssetDisposalTemplate: posted JE ${out.entryNo} for asset ${asset.assetCode} proceeds=${proceeds.toFixed(2)} NBV=${nbv.toFixed(2)} gain/loss=${gainOrLoss.toFixed(2)}`,
    );

    return out;
  }
}
