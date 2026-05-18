import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * P3-SP5 — SHOP Trade-In (รับซื้อมือถือมือสองจากลูกค้า).
 *
 * Trigger: a TradeIn record reaches status=ACCEPTED. Customer hands over a
 * used phone, SHOP pays cash, the phone enters SHOP's used-inventory.
 *
 * JE (single SHOP entry, no FINANCE pairing):
 *
 *   Dr S11-2002 (สินค้าคงคลัง-มือถือมือสอง)   [tradeInPrice]
 *     Cr S11-1101 / S11-1201 (cash or bank)   [tradeInPrice]
 *
 * Note: The trade-in price is the negotiated buy-in (cost basis for the used
 * phone). When the phone is later sold via cash sale or installment, that
 * sale's COGS comes from S11-2002 — which is exactly this cost basis.
 *
 * Idempotency key: `tradein-${tradeInId}`.
 */
export interface ShopTradeInInput {
  idempotencyKey: string;
  tradeInId: string;
  tradeInNumber?: string;
  cashAccountCode: string;
  tradeInPrice: Decimal;
  postedAt?: Date;
}

@Injectable()
export class ShopTradeInTemplate {
  private readonly logger = new Logger(ShopTradeInTemplate.name);
  private shopCompanyId: string | null = null;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  private async getShopCompanyId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.shopCompanyId) return this.shopCompanyId;
    const co = await tx.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!co) throw new BadRequestException('SHOP CompanyInfo not found — seed required');
    this.shopCompanyId = co.id;
    return co.id;
  }

  async execute(
    input: ShopTradeInInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const price = new Decimal(input.tradeInPrice.toString());
    if (!price.gt(zero)) {
      throw new BadRequestException('ShopTradeIn: tradeInPrice must be > 0');
    }
    if (!input.cashAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopTradeIn: cashAccountCode must be SHOP-side (S-prefix); got ${input.cashAccountCode}`,
      );
    }

    const lines: JeLineInput[] = [
      {
        accountCode: 'S11-2002',
        dr: price,
        cr: zero,
        description: 'รับเข้าสต็อก - มือถือมือสอง',
      },
      {
        accountCode: input.cashAccountCode,
        dr: zero,
        cr: price,
        description: 'จ่ายเงินลูกค้า ตีราคารับซื้อ',
      },
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-trade-in' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopTradeInTemplate idempotency — JE ${existing.entryNumber} for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const shopCompanyId = await this.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `รับซื้อมือถือมือสอง ${input.tradeInNumber ?? input.tradeInId} (SHOP)`,
          reference: `tradein:${input.tradeInId}`,
          metadata: {
            tag: 'SHOP_TRADE_IN',
            flow: 'shop-trade-in',
            idempotencyKey: input.idempotencyKey,
            tradeInId: input.tradeInId,
            tradeInNumber: input.tradeInNumber ?? null,
            companyCode: 'SHOP',
            tradeInPrice: price.toFixed(2),
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
