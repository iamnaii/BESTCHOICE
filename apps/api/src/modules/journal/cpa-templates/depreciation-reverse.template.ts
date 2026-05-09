import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface DepreciationReverseInput {
  /** Period in "YYYY-MM" format, e.g. "2026-04" */
  period: string;
  reversedById: string;
}

/**
 * Template — Cascading reverse of monthly depreciation (Phase 2).
 *
 * Pattern (TFRS no-touch, mirror of AssetDisposalReverseTemplate):
 *   - Find ALL unreversed DepreciationEntry rows for the period.
 *   - For each one, locate the original POSTED depreciation JE via
 *     metadata.flow='depreciation' + metadata.assetId + metadata.period.
 *   - Post a mirror JE per asset (Dr/Cr swapped, [VOID] description prefix,
 *     metadata.flow='depreciation-reverse').
 *   - Flag original metadata: {reversed: true, reversedByEntryNumber, reversedAt}.
 *   - Roll back FixedAsset.accumulatedDepr by entry.amount + recompute NBV
 *     (NBV = purchaseCost - newAccum).
 *   - Mark DepreciationEntry.reversedAt + reversedById.
 *
 * Guards:
 *   1. NotFoundException if no DepreciationEntry exists for the period at all.
 *   2. BadRequestException if all entries for the period are already reversed.
 *   3. BadRequestException (cross-period guard) — refuse if any later period has
 *      unreversed entries for ANY of the affected assets. The user must reverse
 *      newer periods first to keep the depreciation timeline consistent.
 *
 * Idempotency: if an original JE is already flagged metadata.reversed===true,
 * we skip it (no-op). If an entry has no matching JE (orphan), we log a warning
 * and skip rather than throw.
 *
 * Atomicity: when caller provides outerTx, runs inside their transaction
 * (no nested $transaction). Otherwise wraps everything in a single
 * this.prisma.$transaction.
 *
 * T2-C14 parity: writes JournalPostAuditLog inside the same $transaction.
 */
@Injectable()
export class DepreciationReverseTemplate {
  private readonly logger = new Logger(DepreciationReverseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: DepreciationReverseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ reversedCount: number; entryNumbers: string[] }> {
    const { period, reversedById } = input;

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ reversedCount: number; entryNumbers: string[] }> => {
      // 1. Find all unreversed entries for this period
      const entries = await tx.depreciationEntry.findMany({
        where: { period, reversedAt: null },
        include: { asset: true },
      });

      if (entries.length === 0) {
        // Disambiguate: nothing-found vs all-already-reversed
        const anyEntries = await tx.depreciationEntry.findFirst({ where: { period } });
        if (!anyEntries) {
          throw new NotFoundException(`ไม่พบ depreciation entries สำหรับงวด ${period}`);
        }
        throw new BadRequestException(`all entries already reversed for period ${period}`);
      }

      // 2. Cross-period guard: refuse if any later period has unreversed entries
      // for ANY of the affected assets. The depreciation timeline must reverse
      // backwards in time (newest period first), or NBV/accum become inconsistent.
      const affectedAssetIds = entries.map((e) => e.assetId);
      const laterUnreversed = await tx.depreciationEntry.findFirst({
        where: {
          assetId: { in: affectedAssetIds },
          period: { gt: period },
          reversedAt: null,
        },
        select: { period: true },
      });
      if (laterUnreversed) {
        throw new BadRequestException(
          `ไม่สามารถ reverse: มีการ run ค่าเสื่อมงวด ${laterUnreversed.period} หลังจากนี้แล้ว ต้อง reverse งวดถัดไปก่อน`,
        );
      }

      const entryNumbers: string[] = [];

      for (const entry of entries) {
        // 3. Locate the original POSTED depreciation JE for (assetId, period)
        const original = await tx.journalEntry.findFirst({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'depreciation' } as any },
              { metadata: { path: ['assetId'], equals: entry.assetId } as any },
              { metadata: { path: ['period'], equals: period } as any },
            ],
            deletedAt: null,
          },
          include: { lines: true },
        });
        if (!original) {
          this.logger.warn(
            `Original depreciation JE not found for asset ${entry.assetId} period ${period} — skipping`,
          );
          continue;
        }

        const originalMeta = (original.metadata ?? {}) as Record<string, unknown>;
        if (originalMeta.reversed === true) {
          this.logger.log(`Skipping already-reversed JE ${original.entryNumber}`);
          continue;
        }

        // 4. Build mirror lines (Dr <-> Cr swap, [VOID] description prefix)
        const reversedLines = original.lines.map((l) => ({
          accountCode: l.accountCode,
          dr: new Decimal(l.credit.toString()),
          cr: new Decimal(l.debit.toString()),
          description: `[VOID] ${l.description ?? ''}`.trim(),
        }));

        // 5. Post mirror JE
        const result = await this.journal.createAndPost(
          {
            description: `[ยกเลิก] กลับรายการค่าเสื่อมงวด ${period} JE ${original.entryNumber}`,
            reference: `${entry.assetId}:reverse-depr-${period}`,
            metadata: {
              tag: 'REVERSAL',
              flow: 'depreciation-reverse',
              period,
              reversedAssetId: entry.assetId,
              originalEntryId: original.id,
              originalEntryNumber: original.entryNumber,
              eventType: 'DEPRECIATION_REVERSAL',
            },
            lines: reversedLines,
            postedAt: new Date(),
          },
          tx,
        );
        entryNumbers.push(result.entryNumber);

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
            } as Prisma.InputJsonValue,
          },
        });

        // 7. Roll back FixedAsset.accumulatedDepr + recompute NBV
        const reverseAmount = new Decimal(entry.amount.toString());
        const currentAccum = new Decimal(entry.asset.accumulatedDepr.toString());
        const purchaseCost = new Decimal(entry.asset.purchaseCost.toString());
        const newAccum = currentAccum.minus(reverseAmount);
        const newNbv = purchaseCost.minus(newAccum);
        await tx.fixedAsset.update({
          where: { id: entry.assetId },
          data: {
            accumulatedDepr: newAccum,
            netBookValue: newNbv,
          },
        });

        // 8. Mark DepreciationEntry as reversed
        await tx.depreciationEntry.update({
          where: { id: entry.id },
          data: {
            reversedAt: new Date(),
            reversedById,
          },
        });

        // 9. T2-C14 parity: immutable audit log inside the same tx.
        await tx.journalPostAuditLog.create({
          data: {
            journalEntryId: result.id,
            postedById: reversedById,
            postedAt: new Date(),
          },
        });
      }

      this.logger.log(
        `[Phase2] DepreciationReverse period ${period} — reversed ${entryNumbers.length} entries`,
      );

      return { reversedCount: entryNumbers.length, entryNumbers };
    };

    if (outerTx) return run(outerTx);
    return this.prisma.$transaction(run);
  }
}
