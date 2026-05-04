import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface BadDebtProvisionInput {
  contractId: string;
  /** Delta provision amount (positive = increase, must be > 0) */
  provisionAmount: Decimal;
  /** Period string e.g. '2026-04' */
  period: string;
}

/**
 * Template — Bad Debt Provision (monthly close).
 *
 * JE:
 *   Dr 51-1103 ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี)   [provisionAmount]
 *     Cr 11-2102 ค่าเผื่อหนี้สงสัยจะสูญ (Contra)      [provisionAmount]
 *
 * Idempotent: skips if a JE with same contractId + period already exists.
 */
@Injectable()
export class BadDebtProvisionTemplate {
  private readonly logger = new Logger(BadDebtProvisionTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: BadDebtProvisionInput): Promise<{ entryNo: string } | null> {
    const { contractId, provisionAmount, period } = input;

    if (provisionAmount.lte(0)) {
      this.logger.warn(
        `[A.5a] BadDebtProvision skipped — provisionAmount=${provisionAmount.toFixed(2)} for contract ${contractId} period ${period}`,
      );
      return null;
    }

    // Idempotency check
    const existing = await this.prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'provision' } } as Prisma.JournalEntryWhereInput,
          {
            metadata: { path: ['contractId'], equals: contractId },
          } as Prisma.JournalEntryWhereInput,
          {
            metadata: { path: ['period'], equals: period },
          } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });

    if (existing) {
      this.logger.log(
        `[A.5a] BadDebtProvision idempotency — JE ${existing.entryNumber} already exists for contract ${contractId} period ${period}, skipping`,
      );
      return { entryNo: existing.entryNumber };
    }

    const zero = new Decimal(0);

    const result = await this.journal.createAndPost({
      description: `ตั้งสำรองหนี้สงสัยจะสูญ — สัญญา ${contractId.slice(0, 8)} งวด ${period}`,
      reference: `${contractId}:bad-debt-provision:${period}`,
      metadata: {
        tag: 'BAD-DEBT',
        flow: 'provision',
        contractId,
        period,
        provisionAmount: provisionAmount.toFixed(2),
      },
      lines: [
        {
          accountCode: '51-1103',
          dr: provisionAmount,
          cr: zero,
          description: `ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี) — ${period}`,
        },
        {
          accountCode: '11-2102',
          dr: zero,
          cr: provisionAmount,
          description: `ค่าเผื่อหนี้สงสัยจะสูญ (Contra) — สัญญา ${contractId.slice(0, 8)}`,
        },
      ],
    });

    return { entryNo: result.entryNumber };
  }
}
