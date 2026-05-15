import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface AssetInvoiceReceivedInput {
  assetId: string;
  triggeredById: string;
}

/**
 * Template — 11-4102 → 11-4101 transfer when supplier tax invoice arrives.
 *
 * Context (Acknowledgment v1 §4.1, Handover v3.7 §5.11.1):
 *   When an asset is POSTed before the tax invoice arrives, ภ.พ.30 cannot yet
 *   claim the input VAT. TFRS accrual practice books to 11-4102 (deferred input
 *   VAT) at POST. Once the tax invoice physically arrives, this template
 *   reclassifies the VAT to 11-4101 (claimable input tax) and the next ภ.พ.30
 *   filing can credit it.
 *
 * JE:
 *   Dr 11-4101  ภาษีซื้อ (เครดิตได้ทันที)         [vatAmount]
 *     Cr 11-4102 ภาษีซื้อรอเรียกเก็บ              [vatAmount]
 *
 * Idempotent — guards by metadata.flow + assetId. A second call with the same
 * assetId returns the existing JE entryNo without posting a duplicate.
 *
 * Period guard (V15): the caller (AssetService.markInvoiceReceived) calls
 * validatePeriodOpen with the trigger date (today = current date) before
 * invoking this template, mirroring asset-purchase + asset-disposal.
 */
@Injectable()
export class AssetInvoiceReceivedTemplate {
  private readonly logger = new Logger(AssetInvoiceReceivedTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: AssetInvoiceReceivedInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const { assetId, triggeredById } = input;

    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });
    if (!asset) {
      throw new NotFoundException(`ไม่พบสินทรัพย์ ${assetId}`);
    }
    if (asset.status !== 'POSTED') {
      throw new BadRequestException(
        `Asset ${asset.assetCode} ต้องอยู่สถานะ POSTED (ปัจจุบัน: ${asset.status})`,
      );
    }
    if (!asset.hasVat) {
      throw new BadRequestException(
        `Asset ${asset.assetCode} ไม่มี VAT — ไม่ต้องโอน 11-4102 → 11-4101`,
      );
    }
    if (asset.vatAccount !== '11-4102') {
      throw new BadRequestException(
        `Asset ${asset.assetCode} ภาษีซื้ออยู่บัญชี ${asset.vatAccount ?? '(ไม่ระบุ)'} — ใช้ flow นี้ได้เฉพาะ 11-4102`,
      );
    }
    const vatAmount = new Decimal(asset.vatAmount.toString());
    if (!vatAmount.gt(0)) {
      throw new BadRequestException(
        `Asset ${asset.assetCode} VAT amount = 0 — ไม่ต้องโอน`,
      );
    }

    type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
    const zero = new Decimal(0);
    const lines: Line[] = [
      {
        accountCode: '11-4101',
        dr: vatAmount,
        cr: zero,
        description: `ภาษีซื้อ (รับใบกำกับ) - ${asset.assetCode}`,
      },
      {
        accountCode: '11-4102',
        dr: zero,
        cr: vatAmount,
        description: `ล้างภาษีซื้อรอเรียกเก็บ - ${asset.assetCode}`,
      },
    ];

    const totalDr = lines.reduce((s, l) => s.plus(l.dr), zero);
    const totalCr = lines.reduce((s, l) => s.plus(l.cr), zero);
    if (!totalDr.equals(totalCr)) {
      throw new BadRequestException(
        `AssetInvoiceReceived JE unbalanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} for asset ${asset.assetCode}`,
      );
    }

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          metadata: { path: ['assetId'], equals: assetId } as any,
          AND: [{ metadata: { path: ['flow'], equals: 'asset-invoice-received' } as any }],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `AssetInvoiceReceivedTemplate idempotency — JE ${existing.entryNumber} already exists for asset ${assetId}, skipping`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const result = await this.journal.createAndPost(
        {
          description: `รับใบกำกับภาษีซื้อ ${asset.assetCode} - ${asset.name}`,
          reference: `${asset.id}:asset-invoice-received`,
          metadata: {
            tag: 'ASSET_INVOICE_RECEIVED',
            flow: 'asset-invoice-received',
            assetId: asset.id,
            assetCode: asset.assetCode,
            vatAmount: vatAmount.toFixed(2),
          },
          postedAt: new Date(),
          lines,
        },
        tx,
      );

      // Pair the JE post with an immutable audit log entry in the same tx
      // (same pattern as asset-purchase / asset-disposal). A failure here
      // rolls back the JE creation — never end up POSTED without audit.
      await tx.journalPostAuditLog.create({
        data: {
          journalEntryId: result.id,
          postedById: triggeredById,
          postedAt: new Date(),
        },
      });

      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };

    const out = outerTx
      ? await run(outerTx)
      : await this.prisma.$transaction(run);

    this.logger.log(
      `AssetInvoiceReceivedTemplate posted JE ${out.entryNo} for asset ${asset.assetCode} vat=${vatAmount.toFixed(2)}`,
    );
    return out;
  }
}
