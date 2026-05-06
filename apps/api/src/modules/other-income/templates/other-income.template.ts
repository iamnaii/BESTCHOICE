import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../../journal/journal-auto.service';
import type { JeLineInput } from '../services/auto-journal.service';

export interface OtherIncomeJeInput {
  /** Human-readable description for the JE */
  description: string;
  /** Date to post the JE under */
  entryDate: Date;
  /** OtherIncome doc ID — stored as referenceId in the JE */
  otherIncomeId: string;
  /** Doc number (e.g. OI-20260506-0001) — stored in metadata */
  docNumber: string;
  /** Auto-generated or override lines from AutoJournalService / PostOtherIncomeDto */
  lines: JeLineInput[];
}

/**
 * OtherIncomeTemplate — wraps JournalAutoService.createAndPost for OtherIncome docs.
 *
 * JeLineInput from auto-journal.service uses { debit, credit } whereas
 * JournalAutoService.createAndPost expects { dr, cr }.  This template
 * bridges the two shapes.
 */
@Injectable()
export class OtherIncomeTemplate {
  constructor(private readonly journal: JournalAutoService) {}

  async post(
    input: OtherIncomeJeInput,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const D = Prisma.Decimal;

    return this.journal.createAndPost(
      {
        description: input.description,
        // reference stored as referenceId (type becomes 'AUTO' by JournalAutoService convention)
        reference: input.otherIncomeId,
        metadata: {
          source: 'OTHER_INCOME',
          docNumber: input.docNumber,
          otherIncomeId: input.otherIncomeId,
        },
        postedAt: input.entryDate,
        // Bridge JeLineInput { debit, credit } → CreateAndPostInput lines { dr, cr }
        lines: input.lines.map((l) => ({
          accountCode: l.accountCode,
          dr: new D(l.debit.toString()),
          cr: new D(l.credit.toString()),
          description: l.description,
        })),
      },
      tx,
    );
  }
}
