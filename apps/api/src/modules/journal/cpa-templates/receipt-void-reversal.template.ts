import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Receipt Void Reversal.
 *
 * Voids a single 2B payment journal entry by posting its mirror (Dr/Cr swapped).
 * The caller (receipts.service) is responsible for marking the Payment/Receipt row
 * as VOIDED. This template only handles the JE side.
 *
 * Idempotent: skips if a reversal JE for the same originalEntryId already exists.
 */
@Injectable()
export class ReceiptVoidReversalTemplate {
  private readonly logger = new Logger(ReceiptVoidReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Post a reversing JE for the given original journal entry.
   * @param originalJournalEntryId - ID of the POSTED 2B JE to reverse
   * @returns entryNo of the new reversal JE
   */
  async voidReceipt(
    originalJournalEntryId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const client = tx ?? this.prisma;
    // Idempotency check
    const existingReversal = await client.journalEntry.findFirst({
      where: {
        AND: [
          {
            metadata: { path: ['originalEntryId'], equals: originalJournalEntryId },
          } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['flow'], equals: 'receipt-void' } } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });

    if (existingReversal) {
      this.logger.log(
        `[A.5a] ReceiptVoidReversal idempotency — reversal ${existingReversal.entryNumber} already exists for JE ${originalJournalEntryId}, skipping`,
      );
      return { entryNo: existingReversal.entryNumber };
    }

    // Load original JE + lines
    const originalJe = await client.journalEntry.findUnique({
      where: { id: originalJournalEntryId },
      include: { lines: true },
    });

    if (!originalJe) {
      throw new BadRequestException(`Journal entry not found: ${originalJournalEntryId}`);
    }

    if (originalJe.status !== 'POSTED') {
      throw new BadRequestException(
        `Cannot void a JE that is not POSTED (status=${originalJe.status})`,
      );
    }

    const existingMeta = (originalJe.metadata ?? {}) as Record<string, unknown>;
    if (existingMeta['reversed'] === true) {
      throw new BadRequestException(
        `JE ${originalJe.entryNumber} is already reversed — cannot void twice`,
      );
    }

    if (originalJe.lines.length === 0) {
      throw new BadRequestException(`JE ${originalJe.entryNumber} has no lines to reverse`);
    }

    // Build reversed lines
    const reversedLines = originalJe.lines.map((l) => ({
      accountCode: l.accountCode,
      dr: new Decimal(l.credit.toString()),
      cr: new Decimal(l.debit.toString()),
      description: `[VOID] ${l.description ?? ''}`.trim(),
    }));

    const result = await this.journal.createAndPost(
      {
        description: `[ยกเลิกใบเสร็จ] ยกเลิก JE ${originalJe.entryNumber}`,
        reference: `${originalJournalEntryId}:void`,
        metadata: {
          tag: 'REVERSAL',
          flow: 'receipt-void',
          originalEntryId: originalJournalEntryId,
          originalEntryNumber: originalJe.entryNumber,
        },
        lines: reversedLines,
      },
      tx,
    );

    // Mark original as reversed
    await client.journalEntry.update({
      where: { id: originalJournalEntryId },
      data: {
        metadata: {
          ...(existingMeta as Prisma.InputJsonObject),
          reversed: true,
          reversedByEntryNumber: result.entryNumber,
        },
      },
    });

    this.logger.log(
      `[A.5a] ReceiptVoidReversal — reversed JE ${originalJe.entryNumber} → ${result.entryNumber}`,
    );

    return { entryNo: result.entryNumber };
  }
}
