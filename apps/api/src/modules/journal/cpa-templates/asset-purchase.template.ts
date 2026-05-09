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
 * JE structure (legally compliant per ทป.4/2528 + ม.50 ทวิ + ม.82/3):
 *   Dr 12-21XX  สินทรัพย์ - <category>           [purchaseCost = basePrice excl VAT]
 *   Dr 11-4101  ภาษีซื้อ                          [vatAmount]   ← always when hasVat (ม.82/3)
 *     Cr 21-3102/03 WHT (service portion only)    [whtAmount]
 *     Cr <paymentAccount>                         [totalPayable = cost + vat - wht]
 *
 * VAT (CRITICAL #2 fix): Per ม.82/3, ภาษีซื้อหักเครดิตได้ทุกกรณี ไม่ว่า
 * inclusive หรือ exclusive. Both branches now post Dr 11-4101.
 *   - exclusive: basePrice + 7% on top → vatAmount = basePrice × 0.07
 *   - inclusive: vatAmount extracted = basePrice × 7/107, basePrice ex-VAT = basePrice − vatAmount
 *   (computeCostFields in asset.service.ts already does this extraction)
 *
 * WHT (CRITICAL #1 fix): WHT applies ONLY to service/hire-of-work components
 * per ทป.4/2528 + ม.40(7)(8). Goods purchases (vehicles, equipment, furniture)
 * MUST NOT carry WHT. The asset.service computeCostFields enforces:
 *   whtBaseAmount default → installationCost (service portion)
 * Caller controls whether hasWht=true via DTO. This template trusts the DTO
 * but the service layer guards against goods-only assets having hasWht=true.
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

  async execute(
    input: AssetPurchaseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const { assetId, postedById } = input;

    // Asset existence check — use outer tx if provided so we read inside the
    // caller's transaction snapshot (consistent with other reads).
    const reader = (outerTx ?? this.prisma) as Prisma.TransactionClient;
    const asset = await reader.fixedAsset.findFirst({
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

    // Dr VAT input — ม.82/3 ภาษีซื้อเครดิตได้ทุกกรณี
    // basePrice in DB is always excl VAT (computeCostFields extracts it for inclusive case),
    // so vatAmount + 11-4101 is posted regardless of inclusive/exclusive.
    if (asset.hasVat && vatAmount.gt(0) && asset.vatAccount) {
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

    // Cr payment account — purchaseCost (excl VAT) + vatAmount − whtAmount.
    // No vatInclusive branching: basePrice is normalized to excl-VAT in
    // computeCostFields, so adding vatAmount yields the correct cash outflow
    // for both inclusive (21,400) and exclusive (53,500) cases.
    const totalPayable = purchaseCost.plus(vatAmount).minus(whtAmount);
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
    //
    // When outerTx is provided, we run inside the caller's transaction (no nested $transaction)
    // so service-level atomicity (template + asset status update + AuditLog) is achievable.
    const run = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          metadata: { path: ['assetId'], equals: assetId } as any,
          AND: [{ metadata: { path: ['flow'], equals: 'asset-purchase' } as any }],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `[Phase1] AssetPurchaseTemplate idempotency — JE ${existing.entryNumber} already exists for asset ${assetId}, skipping`,
        );
        return { entryNo: existing.entryNumber };
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
          journalEntryId: result.id,
          postedById,
          postedAt: new Date(),
        },
      });

      return { entryNo: result.entryNumber };
    };

    const out = outerTx
      ? await run(outerTx)
      : await this.prisma.$transaction(run);

    this.logger.log(
      `[Phase1] AssetPurchaseTemplate posted JE ${out.entryNo} for asset ${asset.assetCode} cost=${purchaseCost.toFixed(2)}`,
    );
    return out;
  }
}
