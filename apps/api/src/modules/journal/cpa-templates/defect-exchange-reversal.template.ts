import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

const PAYMENT_FLOWS = ['payment', 'split-payment', 'early-payoff', 'reschedule'];
const REVERSAL_FLOWS = ['defect-exchange', 'receipt-void'];

/**
 * Template — Defect Exchange Reversal.
 *
 * When a defective device is exchanged within the 7-day window, all previously
 * posted JEs for the old contract must be reversed so the accounting footprint
 * is zeroed out before the new contract's 1A is posted.
 *
 * Strategy: find all POSTED JEs tagged with contractId (via metadata), skip any
 * already-reversed JEs, skip payment-side JEs (2B/early-payoff — business rules
 * state no payments exist within the 7-day window, but we guard defensively).
 * For each eligible JE, post a mirror JE with Dr/Cr swapped.
 */
@Injectable()
export class DefectExchangeReversalTemplate {
  private readonly logger = new Logger(DefectExchangeReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Reverse all contract-activation JEs for the given contract.
   * Idempotent: skips JEs already marked reversed.
   */
  async reverseContract(
    contractId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ reversedCount: number; entryNos: string[] }> {
    const client = tx ?? this.prisma;
    const contract = await client.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { contractNumber: true },
    });

    // Find all posted JEs tagged to this contract (metadata.contractId)
    const originalJes = await client.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
        ],
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });

    if (originalJes.length === 0) {
      this.logger.warn(
        `[A.5a] DefectExchangeReversal — no posted JEs found for contract ${contract.contractNumber} (${contractId}). Nothing to reverse.`,
      );
      return { reversedCount: 0, entryNos: [] };
    }

    const entryNos: string[] = [];

    for (const je of originalJes) {
      const meta = (je.metadata ?? {}) as Record<string, unknown>;

      // Skip already reversed
      if (meta['reversed'] === true) {
        this.logger.log(
          `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} already reversed, skipping`,
        );
        continue;
      }

      // Skip payment-side JEs and reversal JEs themselves (defensive guard)
      const flow = (meta['flow'] as string | undefined) ?? '';
      if (PAYMENT_FLOWS.includes(flow)) {
        this.logger.warn(
          `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} has payment flow '${flow}', skipping (unexpected in 7-day window)`,
        );
        continue;
      }
      if (REVERSAL_FLOWS.includes(flow) && meta['tag'] === 'REVERSAL') {
        this.logger.log(
          `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is itself a reversal JE, skipping`,
        );
        continue;
      }

      // Idempotency: check if reversal JE already exists for this original
      const existingReversal = await client.journalEntry.findFirst({
        where: {
          AND: [
            {
              metadata: { path: ['originalEntryId'], equals: je.id },
            } as Prisma.JournalEntryWhereInput,
            {
              metadata: { path: ['flow'], equals: 'defect-exchange' },
            } as Prisma.JournalEntryWhereInput,
          ],
          deletedAt: null,
        },
      });

      if (existingReversal) {
        this.logger.log(
          `[A.5a] DefectExchangeReversal — reversal for JE ${je.entryNumber} already exists (${existingReversal.entryNumber}), skipping`,
        );
        entryNos.push(existingReversal.entryNumber);
        continue;
      }

      if (je.lines.length === 0) {
        this.logger.warn(`[A.5a] DefectExchangeReversal — JE ${je.entryNumber} has no lines, skipping`);
        continue;
      }

      // Build reversed lines (swap Dr/Cr)
      const reversedLines = je.lines.map((l) => ({
        accountCode: l.accountCode,
        dr: new Decimal(l.credit.toString()),
        cr: new Decimal(l.debit.toString()),
        description: `[REVERSAL] ${l.description ?? ''}`.trim(),
      }));

      const result = await this.journal.createAndPost(
        {
          description: `[เปลี่ยนเครื่องตำหนิ] ยกเลิก JE ${je.entryNumber} — สัญญา ${contract.contractNumber}`,
          reference: `${je.id}:reversal`,
          metadata: {
            tag: 'REVERSAL',
            flow: 'defect-exchange',
            originalEntryId: je.id,
            contractId,
          },
          lines: reversedLines,
        },
        tx,
      );

      // Mark original as reversed
      await client.journalEntry.update({
        where: { id: je.id },
        data: {
          metadata: {
            ...(meta as Prisma.InputJsonObject),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
          },
        },
      });

      entryNos.push(result.entryNumber);
    }

    this.logger.log(
      `[A.5a] DefectExchangeReversal — reversed ${entryNos.length} JEs for contract ${contract.contractNumber}`,
    );

    return { reversedCount: entryNos.length, entryNos };
  }
}
