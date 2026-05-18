import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * P3-SP5 — SHOP Installment Down-Payment Receipt.
 *
 * Trigger: customer pays the down portion (เงินดาวน์) at SHOP during the
 * contract-creation flow. FINANCE will later wire `financedAmount + commission`
 * to SHOP separately — that flow uses `ShopFinanceReceiptTemplate`. Booking
 * the down separately here means the SHOP P&L correctly reflects "cash in
 * hand from down-payment" the moment the customer pays, even before FINANCE
 * settles its part of the deal.
 *
 * JE (single SHOP entry — no FINANCE pairing yet):
 *
 *   Dr S11-1101 / S11-1201 (cash or bank)               [downAmount]
 *     Cr S21-2001 เงินรับล่วงหน้า (down-payment payable) [downAmount]
 *
 * S21-2001 stays on the books until the FINANCE receipt JE clears it
 * (`ShopFinanceReceiptTemplate` posts Dr S21-2001 / Cr S41-1101).
 *
 * No paired FINANCE entry — the down stays on SHOP's side until the contract
 * is finalised, then FINANCE wires its share and the booking finishes.
 */
export interface ShopDownPaymentInput {
  /** Idempotency anchor — usually `down-${contractId}`. */
  idempotencyKey: string;
  contractId: string;
  contractNumber?: string;
  cashAccountCode: string;
  downAmount: Decimal;
  postedAt?: Date;
}

@Injectable()
export class ShopDownPaymentTemplate {
  private readonly logger = new Logger(ShopDownPaymentTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopDownPaymentInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const down = new Decimal(input.downAmount.toString());
    if (!down.gt(zero)) {
      throw new BadRequestException('ShopDownPayment: downAmount must be > 0');
    }
    if (!input.cashAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopDownPayment: cashAccountCode must be SHOP-side (S-prefix); got ${input.cashAccountCode}`,
      );
    }

    const lines: JeLineInput[] = [
      { accountCode: input.cashAccountCode, dr: down, cr: zero, description: 'รับเงินดาวน์จากลูกค้า' },
      {
        accountCode: 'S21-2001',
        dr: zero,
        cr: down,
        description: 'เงินรับล่วงหน้า (เงินดาวน์) รอเคลียร์',
      },
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-down-payment' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopDownPaymentTemplate idempotency — JE ${existing.entryNumber} already exists for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `รับเงินดาวน์ — สัญญา ${input.contractNumber ?? input.contractId} (SHOP)`,
          reference: `contract:${input.contractId}:down`,
          metadata: {
            tag: 'SHOP_DOWN_PAYMENT',
            flow: 'shop-down-payment',
            idempotencyKey: input.idempotencyKey,
            contractId: input.contractId,
            contractNumber: input.contractNumber ?? null,
            companyCode: 'SHOP',
            downAmount: down.toFixed(2),
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
