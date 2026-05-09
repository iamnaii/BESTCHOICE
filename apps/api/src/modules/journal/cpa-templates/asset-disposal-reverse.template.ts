import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface AssetDisposalReverseInput {
  assetId: string;
  reversedById: string;
  reason: string;
}

/**
 * Template — Reverse a fixed asset disposal JE (Phase 2).
 *
 * Pattern (TFRS no-touch):
 *   - Original POSTED disposal JE is NEVER modified beyond a metadata flag.
 *   - A new mirror JE is created with Dr/Cr swapped, descriptions prefixed [VOID].
 *   - Original metadata gets {reversed: true, reversedByEntryNumber, reversedAt}.
 *   - Asset row restored: status=POSTED, disposalDate=null, NBV recomputed
 *     from purchaseCost - accumulatedDepr.
 *
 * Guards:
 *   1. reason.trim() must be non-empty.
 *   2. Original disposal JE must exist (metadata.flow='asset-disposal' + assetId).
 *   3. Original must NOT already be reversed (metadata.reversed !== true).
 *
 * Idempotency: TOCTOU-safe — runs inside $transaction.
 *
 * T2-C14 parity: writes JournalPostAuditLog inside the same $transaction.
 *
 * Atomicity: when caller provides outerTx, runs inside their transaction
 * (no nested $transaction).
 */
@Injectable()
export class AssetDisposalReverseTemplate {
  private readonly logger = new Logger(AssetDisposalReverseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: AssetDisposalReverseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const { assetId, reversedById, reason } = input;

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ');
    }

    const run = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      // 1. Find original disposal JE via metadata flow + assetId (TOCTOU-safe inside tx)
      const original = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'asset-disposal' } as any },
            { metadata: { path: ['assetId'], equals: assetId } as any },
          ],
          deletedAt: null,
        },
        include: { lines: true },
      });
      if (!original) {
        throw new NotFoundException(`Original disposal JE not found for asset ${assetId}`);
      }

      // 2. Already-reversed check (re-checked inside tx for race protection)
      const originalMeta = (original.metadata ?? {}) as Record<string, unknown>;
      if (originalMeta.reversed === true) {
        throw new BadRequestException(
          `Asset ${assetId} disposal already reversed — original JE ${original.entryNumber} flagged reversed=true`,
        );
      }

      // 3. Defensive: asset row must exist
      const asset = await tx.fixedAsset.findFirst({
        where: { id: assetId, deletedAt: null },
      });
      if (!asset) {
        throw new NotFoundException(`Asset ${assetId} not found`);
      }

      // 4. Build mirror lines (Dr <-> Cr swap, prefix description with [VOID])
      type Line = {
        accountCode: string;
        dr: Decimal;
        cr: Decimal;
        description?: string;
      };
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
          `AssetDisposalReverse JE unbalanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} for asset ${assetId}`,
        );
      }

      // 5. Post mirror JE
      const result = await this.journal.createAndPost(
        {
          description: `[ยกเลิก] กลับรายการจำหน่ายสินทรัพย์ JE ${original.entryNumber}`,
          reference: `${assetId}:reverse-dispose`,
          metadata: {
            tag: 'REVERSAL',
            flow: 'asset-disposal-reverse',
            assetId,
            originalEntryId: original.id,
            originalEntryNumber: original.entryNumber,
            reversalReason: reason,
            eventType: 'ASSET_DISPOSAL_REVERSAL',
          },
          lines: reversedLines,
          postedAt: new Date(),
        },
        tx,
      );

      // 6. Flag original — TFRS no-touch: only the metadata bag changes.
      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          metadata: {
            ...originalMeta,
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
            reversedByEntryId: result.id,
            reversedAt: new Date().toISOString(),
            reversalReason: reason,
          },
        },
      });

      // 7. Restore asset state: status=POSTED, clear disposalDate, recompute NBV
      const purchaseCost = new Decimal(asset.purchaseCost.toString());
      const accumulatedDepr = new Decimal(asset.accumulatedDepr.toString());
      const restoredNbv = purchaseCost.minus(accumulatedDepr);
      await tx.fixedAsset.update({
        where: { id: assetId },
        data: {
          status: 'POSTED',
          disposalDate: null,
          netBookValue: restoredNbv,
        },
      });

      // 8. T2-C14 parity: immutable audit log inside the same tx.
      await tx.journalPostAuditLog.create({
        data: {
          journalEntryId: result.id,
          postedById: reversedById,
          postedAt: new Date(),
        },
      });

      return { entryNo: result.entryNumber };
    };

    const out = outerTx ? await run(outerTx) : await this.prisma.$transaction(run);

    this.logger.log(
      `[Phase2] AssetDisposalReverseTemplate posted JE ${out.entryNo} reversing disposal for asset ${assetId}`,
    );
    return out;
  }
}
