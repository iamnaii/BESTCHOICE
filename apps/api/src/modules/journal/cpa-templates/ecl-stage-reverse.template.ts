import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface EclStageReverseInput {
  contractId: string;
  /** Amount to reverse (positive — must be > 0) */
  reverseAmount: Decimal;
  /** Aging bucket BEFORE the payment (e.g. '31-60' = B2) */
  fromBucket: string;
  /** Aging bucket AFTER the payment (e.g. '1-30' = B1) */
  toBucket: string;
  /** Optional period tag (defaults to current YYYY-MM) for traceability */
  period?: string;
}

/**
 * Template — ECL Stage Reverse (CPA Policy A spec §3.6).
 *
 * When a customer pays an overdue installment and the contract's max-aging
 * bucket drops (e.g. B2 → B1, B3 → B0), the previously-recognised provision
 * is now over-stated. This template releases the over-provision back to P&L:
 *
 *   Dr 11-2102 ค่าเผื่อหนี้สงสัยจะสูญ (Contra)   reverseAmount
 *     Cr 51-1103 ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี)  reverseAmount
 *
 * Mirror of `BadDebtProvisionTemplate`. Caller computes the delta —
 * usually `BadDebtService.reverseStageOnPayment(contractId)` after a 2B
 * payment, where the new aging bucket is recalculated and the delta
 * against the persisted ACTIVE provision is fed in.
 *
 * Atomicity: meant to be called inside the same `$transaction` as the 2B
 * receipt JE so a failed reverse rolls back the payment. Pass `tx` as
 * the second arg to chain into the caller's transaction.
 */
@Injectable()
export class EclStageReverseTemplate {
  private readonly logger = new Logger(EclStageReverseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: EclStageReverseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    if (input.reverseAmount.lte(0)) {
      this.logger.warn(
        `EclStageReverse skipped — reverseAmount=${input.reverseAmount.toFixed(2)} is non-positive (contract=${input.contractId})`,
      );
      return null;
    }

    const period =
      input.period ??
      (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      })();

    const exec = async (tx: Prisma.TransactionClient) => {
      const zero = new Decimal(0);
      const result = await this.journal.createAndPost(
        {
          description: `ECL stage reverse ${input.fromBucket}→${input.toBucket} — สัญญา ${input.contractId.slice(0, 8)}`,
          reference: `${input.contractId}:ecl-stage-reverse:${period}:${input.fromBucket}-${input.toBucket}:${Date.now()}`,
          metadata: {
            tag: 'ECL-STAGE-REVERSE',
            flow: 'stage-reverse',
            contractId: input.contractId,
            period,
            fromBucket: input.fromBucket,
            toBucket: input.toBucket,
            reverseAmount: input.reverseAmount.toFixed(2),
          },
          lines: [
            {
              accountCode: '11-2102',
              dr: input.reverseAmount,
              cr: zero,
              description: `กลับสำรอง ${input.fromBucket}→${input.toBucket}`,
            },
            {
              accountCode: '51-1103',
              dr: zero,
              cr: input.reverseAmount,
              description: 'กลับค่าเผื่อหนี้สงสัยจะสูญ',
            },
          ],
        },
        tx,
      );

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
