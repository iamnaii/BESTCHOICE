import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface AssetPurchaseReverseInput {
  assetId: string;
  reversedById: string;
  reason: string;
}

/**
 * Template — Reverse a fixed asset purchase JE (Phase 1).
 *
 * Pattern (TFRS no-touch):
 *   - Original POSTED JE is NEVER modified beyond a metadata flag.
 *   - A new mirror JE is created with Dr/Cr swapped.
 *   - Original metadata gets {reversed: true, reversedByEntryNumber, reversedAt}.
 *
 * Guards:
 *   1. reason.trim() must be non-empty.
 *   2. Original purchase JE must exist (metadata.flow='asset-purchase' + assetId).
 *   3. Original must NOT already be reversed.
 *   4. Asset must NOT have any DepreciationEntry rows (must reverse those first).
 *
 * Idempotency: TOCTOU-safe — re-checks inside $transaction to block races.
 *
 * T2-C14 parity: writes JournalPostAuditLog inside the same $transaction.
 */
@Injectable()
export class AssetPurchaseReverseTemplate {
  private readonly logger = new Logger(AssetPurchaseReverseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: AssetPurchaseReverseInput): Promise<{ entryNo: string }> {
    const { assetId, reversedById, reason } = input;

    // 1. reason validation
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Reversal reason is required');
    }

    // 2. find original purchase JE via metadata flow + assetId
    const original = await this.prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-purchase' } as any },
          { metadata: { path: ['assetId'], equals: assetId } as any },
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    if (!original) {
      throw new NotFoundException(`Original purchase JE not found for asset ${assetId}`);
    }

    // 3. already-reversed check (read-only — re-checked inside tx for TOCTOU)
    const originalMeta = (original.metadata ?? {}) as Record<string, unknown>;
    if (originalMeta.reversed === true) {
      throw new BadRequestException(
        `Asset already reversed — original JE ${original.entryNumber} flagged reversed=true`,
      );
    }

    // 4. block if any depreciation entry exists for this asset
    const deprCount = await this.prisma.depreciationEntry.count({ where: { assetId } });
    if (deprCount > 0) {
      throw new BadRequestException(
        `Cannot reverse: asset has ${deprCount} depreciation entries. Reverse those first.`,
      );
    }

    // 5. build mirror lines (Dr <-> Cr swap, prefix description with [VOID])
    type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
    const reversedLines: Line[] = original.lines.map((l) => ({
      accountCode: l.accountCode,
      dr: new Decimal(l.credit.toString()),
      cr: new Decimal(l.debit.toString()),
      description: `[VOID] ${l.description ?? ''}`.trim(),
    }));

    // Sanity check (createAndPost also checks)
    const totalDr = reversedLines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = reversedLines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    if (!totalDr.equals(totalCr)) {
      throw new BadRequestException(
        `AssetPurchaseReverse JE unbalanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} for asset ${assetId}`,
      );
    }

    // 6. transactional: TOCTOU-safe idempotency + post + flag original + audit
    let entryNo: string | undefined;
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Re-check: another caller may have raced and already reversed
      const existingReversal = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'asset-purchase-reverse' } as any },
            { metadata: { path: ['assetId'], equals: assetId } as any },
          ],
          deletedAt: null,
        },
      });
      if (existingReversal) {
        throw new BadRequestException(
          `Asset already reversed — reversal JE ${existingReversal.entryNumber} exists`,
        );
      }

      // Re-check the original metadata flag inside the tx
      const freshOriginal = await tx.journalEntry.findUnique({
        where: { id: original.id },
        select: { metadata: true },
      });
      const freshMeta = (freshOriginal?.metadata ?? {}) as Record<string, unknown>;
      if (freshMeta.reversed === true) {
        throw new BadRequestException(
          `Asset already reversed — original JE ${original.entryNumber} flagged reversed=true`,
        );
      }

      const result = await this.journal.createAndPost(
        {
          description: `[ยกเลิก] กลับรายการซื้อสินทรัพย์ JE ${original.entryNumber}`,
          metadata: {
            tag: 'REVERSAL',
            flow: 'asset-purchase-reverse',
            assetId,
            originalEntryId: original.id,
            originalEntryNumber: original.entryNumber,
            reversalReason: reason,
            eventType: 'ASSET_PURCHASE_REVERSAL',
          },
          lines: reversedLines,
          postedAt: new Date(),
        },
        tx,
      );
      entryNo = result.entryNumber;

      // Flag the original JE — TFRS no-touch: only the metadata bag changes.
      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          metadata: {
            ...freshMeta,
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
            reversedByEntryId: result.id,
            reversedAt: new Date().toISOString(),
            reversalReason: reason,
          },
        },
      });

      // T2-C14 parity: immutable audit log inside the same tx.
      await tx.journalPostAuditLog.create({
        data: {
          journalEntryId: result.id,
          postedById: reversedById,
          postedAt: new Date(),
        },
      });
    });

    if (!entryNo) {
      throw new Error('AssetPurchaseReverse: failed to determine entry number');
    }

    this.logger.log(
      `[Phase1] AssetPurchaseReverseTemplate posted JE ${entryNo} reversing ${original.entryNumber} for asset ${assetId}`,
    );
    return { entryNo };
  }
}
