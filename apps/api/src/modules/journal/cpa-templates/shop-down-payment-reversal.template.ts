import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * P3-SP5 W2 — Reverse a SHOP down-payment when contract is cancelled
 * BEFORE activation.
 *
 * Trigger: a contract whose down-payment was booked via
 * `ShopDownPaymentTemplate` is cancelled before it reaches ACTIVATION.
 * The customer is refunded their down. We need to reverse:
 *
 *   ORIGINAL (Dr cash / Cr S21-2001)
 *   REVERSE  (Dr S21-2001 / Cr cash)
 *
 * Why a dedicated template (vs reusing ShopDownPaymentTemplate with
 * negative amounts):
 *   - Negative debits break audit reports and most rounding utilities.
 *   - A reversal entry is its OWN ledger event that auditors want to see
 *     paired with the original (`metadata.reversedByBatchId` /
 *     `metadata.reversesEntryId`).
 *   - The cash account paying the refund may differ from the cash account
 *     that received the down (refund routed through a different till /
 *     bank). Caller passes the actual refund account.
 *
 * Note: this template does NOT touch revenue / receivables / inventory —
 * those are never touched at down-payment time, so a pre-activation
 * cancel does not need to reverse them either.
 */
export interface ShopDownPaymentReversalInput {
  /**
   * Idempotency anchor. Typically
   * `down-reversal-${contractId}` or `down-reversal-${originalJournalEntryId}`.
   */
  idempotencyKey: string;
  contractId: string;
  contractNumber?: string;
  /** Cash account paying the refund (S11-1101..1103 or S11-1201..1202). */
  refundAccountCode: string;
  /** Original down amount being reversed. Must equal the original JE amount. */
  downAmount: Decimal;
  /** ID of the original JE that posted the down (for paired audit trail). */
  originalJournalEntryId?: string;
  postedAt?: Date;
}

@Injectable()
export class ShopDownPaymentReversalTemplate {
  private readonly logger = new Logger(ShopDownPaymentReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopDownPaymentReversalInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const down = new Decimal(input.downAmount.toString());
    if (!down.gt(zero)) {
      throw new BadRequestException(
        'ShopDownPaymentReversal: downAmount must be > 0',
      );
    }
    if (!input.refundAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopDownPaymentReversal: refundAccountCode must be SHOP-side (S-prefix); got ${input.refundAccountCode}`,
      );
    }

    const lines: JeLineInput[] = [
      {
        accountCode: 'S21-2001',
        dr: down,
        cr: zero,
        description: 'ล้างเงินรับล่วงหน้า (เงินดาวน์) - กลับรายการ',
      },
      {
        accountCode: input.refundAccountCode,
        dr: zero,
        cr: down,
        description: 'คืนเงินดาวน์ลูกค้า',
      },
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            {
              metadata: {
                path: ['flow'],
                equals: 'shop-down-payment-reversal',
              } as any,
            },
            {
              metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any,
            },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopDownPaymentReversalTemplate idempotency — JE ${existing.entryNumber} for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      // If caller supplied an originalJournalEntryId, stamp the back-ref
      // onto the ORIGINAL JE's metadata so reports can pair them. We use
      // updateMany so we don't 404 if the original was already updated.
      if (input.originalJournalEntryId) {
        const original = await tx.journalEntry.findUnique({
          where: { id: input.originalJournalEntryId },
          select: { id: true, metadata: true },
        });
        if (original) {
          const mergedMetadata = {
            ...((original.metadata as Record<string, unknown> | null) ?? {}),
            reversedByIdempotencyKey: input.idempotencyKey,
          };
          await tx.journalEntry.update({
            where: { id: original.id },
            data: { metadata: mergedMetadata as Prisma.InputJsonValue },
          });
        }
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `กลับรายการเงินดาวน์ — สัญญา ${input.contractNumber ?? input.contractId} (SHOP)`,
          reference: `contract:${input.contractId}:down-reversal`,
          metadata: {
            tag: 'SHOP_DOWN_PAYMENT_REVERSAL',
            flow: 'shop-down-payment-reversal',
            idempotencyKey: input.idempotencyKey,
            contractId: input.contractId,
            contractNumber: input.contractNumber ?? null,
            companyCode: 'SHOP',
            downAmount: down.toFixed(2),
            originalJournalEntryId: input.originalJournalEntryId ?? null,
            reversedByBatchId: input.idempotencyKey,
          },
          postedAt: input.postedAt ?? new Date(),
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };

    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }
}
