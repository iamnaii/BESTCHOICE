import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** Maps AssetCategory → [costCode, accumulatedDeprCode, deprExpenseCode] */
const CATEGORY_CHART: Record<string, [string, string, string]> = {
  EQUIPMENT: ['12-2101', '12-2102', '53-1601'],
  IMPROVEMENT: ['12-2103', '12-2104', '53-1602'],
  FURNITURE: ['12-2105', '12-2106', '53-1603'],
  VEHICLE: ['12-2107', '12-2108', '53-1604'],
};

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

export interface AssetPurchaseInput {
  assetId: string;
  postedById: string;
}

/**
 * Template — Fixed asset purchase (Phase 1).
 *
 * JE structure:
 *   Dr 12-21XX  สินทรัพย์ - <category>           [purchaseCost]
 *   Dr 11-4101  ภาษีซื้อ (VAT exclusive only)    [vatAmount]
 *     Cr 21-3102/03 WHT (if hasWht)              [whtAmount]
 *     Cr <paymentAccount>                         [totalPayable = cost + (excl ? vat : 0) - wht]
 *
 * Category → cost account routing:
 *   EQUIPMENT   → 12-2101  (depr 12-2102 / expense 53-1601)
 *   IMPROVEMENT → 12-2103  (depr 12-2104 / expense 53-1602)
 *   FURNITURE   → 12-2105  (depr 12-2106 / expense 53-1603)
 *   VEHICLE     → 12-2107  (depr 12-2108 / expense 53-1604)
 *
 * Account snapshots (Handover Fix #1.2): cost/depr/expense codes are pinned
 * onto the asset row at POST so future depreciation/disposal JEs are immune
 * to A.6 dynamic CoA remapping.
 *
 * Idempotent: second call with the same assetId returns the same JE.
 *
 * T2-C14: writes JournalPostAuditLog inside the same $transaction as the JE
 * post — if audit insert fails, the entire post rolls back.
 */
@Injectable()
export class AssetPurchaseTemplate {
  private readonly logger = new Logger(AssetPurchaseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: AssetPurchaseInput): Promise<{ entryNo: string }> {
    const { assetId, postedById } = input;

    // Asset existence check (read-only, no race condition — leave outside tx)
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });
    if (!asset) {
      throw new NotFoundException(`ไม่พบสินทรัพย์ id=${assetId}`);
    }

    const codeTriple = CATEGORY_CHART[asset.category];
    if (!codeTriple) {
      throw new BadRequestException(
        `ไม่พบรหัสบัญชีสำหรับหมวดสินทรัพย์ ${asset.category} (asset ${asset.assetCode})`,
      );
    }
    const [costCode, accDeprCode, expenseCode] = codeTriple;
    const label = CATEGORY_LABEL[asset.category] ?? 'สินทรัพย์';

    if (!asset.paymentAccount) {
      throw new BadRequestException(
        `Asset ${asset.assetCode} ไม่มี paymentAccount — กำหนดบัญชีชำระเงินก่อนโพสต์`,
      );
    }

    const purchaseCost = new Decimal(asset.purchaseCost.toString());
    const vatAmount = new Decimal(asset.vatAmount.toString());
    const whtAmount = new Decimal(asset.whtAmount.toString());
    const zero = new Decimal(0);

    type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
    const lines: Line[] = [];

    // Dr asset cost (always)
    lines.push({
      accountCode: costCode,
      dr: purchaseCost,
      cr: zero,
      description: `${label} - ${asset.assetCode}`,
    });

    // Dr VAT input (exclusive only — inclusive is already part of basePrice)
    if (asset.hasVat && !asset.vatInclusive && vatAmount.gt(0) && asset.vatAccount) {
      lines.push({
        accountCode: asset.vatAccount,
        dr: vatAmount,
        cr: zero,
        description: `ภาษีซื้อ - ${asset.assetCode}`,
      });
    }

    // Cr WHT (if applicable) — reduces cash payment to vendor
    if (asset.hasWht && whtAmount.gt(0) && asset.whtAccount) {
      lines.push({
        accountCode: asset.whtAccount,
        dr: zero,
        cr: whtAmount,
        description: `WHT ${asset.whtFormType ?? ''} - ${asset.assetCode}`,
      });
    }

    // Cr payment account — net of WHT, plus exclusive VAT
    const totalPayable = purchaseCost
      .plus(asset.vatInclusive ? zero : vatAmount)
      .minus(whtAmount);
    lines.push({
      accountCode: asset.paymentAccount,
      dr: zero,
      cr: totalPayable,
      description: `ชำระค่า ${label} - ${asset.assetCode}`,
    });

    // Sanity check (createAndPost also checks, but explicit error is friendlier)
    const totalDr = lines.reduce((s, l) => s.plus(l.dr), zero);
    const totalCr = lines.reduce((s, l) => s.plus(l.cr), zero);
    if (!totalDr.equals(totalCr)) {
      throw new BadRequestException(
        `AssetPurchase JE unbalanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} for asset ${asset.assetCode}`,
      );
    }

    // Wrap idempotency check + JE post + asset snapshot update + audit log in a single transaction.
    // The idempotency check MUST be inside the tx to prevent TOCTOU races where two concurrent
    // calls for the same assetId both pass the check and create duplicate POSTED JEs.
    let entryNo: string | undefined;
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          metadata: { path: ['assetId'], equals: assetId } as any,
          AND: [{ metadata: { path: ['flow'], equals: 'asset-purchase' } as any }],
          deletedAt: null,
        },
      });
      if (existing) {
        entryNo = existing.entryNumber;
        this.logger.log(
          `[Phase1] AssetPurchaseTemplate idempotency — JE ${entryNo} already exists for asset ${assetId}, skipping`,
        );
        return;
      }

      const result = await this.journal.createAndPost(
        {
          description: `ซื้อสินทรัพย์ ${asset.assetCode} - ${asset.name}`,
          reference: `${asset.id}:asset-purchase`,
          metadata: {
            tag: 'ASSET_PURCHASE',
            flow: 'asset-purchase',
            assetId: asset.id,
            assetCode: asset.assetCode,
            categorySnapshot: asset.category,
            vatInclusive: asset.vatInclusive,
          },
          postedAt: asset.purchaseDate,
          lines,
        },
        tx,
      );
      entryNo = result.entryNumber;
      const entryId = result.id;

      // Pin account snapshots to the asset (Handover Fix #1.2)
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          coaCostAccount: costCode,
          coaDeprAccount: accDeprCode,
          coaExpenseAccount: expenseCode,
        },
      });

      // T2-C14: write the immutable audit log in the same tx so a failure here
      // rolls back the JE post — never end up with a POSTED entry sans audit.
      await tx.journalPostAuditLog.create({
        data: {
          journalEntryId: entryId,
          postedById,
          postedAt: new Date(),
        },
      });
    });

    if (!entryNo) {
      throw new Error('AssetPurchase: failed to determine entry number');
    }

    this.logger.log(
      `[Phase1] AssetPurchaseTemplate posted JE ${entryNo} for asset ${asset.assetCode} cost=${purchaseCost.toFixed(2)}`,
    );
    return { entryNo };
  }
}
