import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * P3-SP5 — SHOP Trade-In (รับซื้อมือถือมือสองจากลูกค้า).
 *
 * Two-stage trade-in flow (see .claude/rules/accounting.md SHOP section):
 *
 *   Stage 1 — Customer drops off used phone for evaluation:
 *     pending evaluation → Dr S11-2004 (สินค้าระหว่างประเมินราคา)
 *     A cash deposit may or may not be advanced here. If the shop pre-pays a
 *     deposit before final pricing, the trade-in is booked under 'S11-2004'
 *     so the unit is segregated from sellable stock until appraisal closes.
 *
 *   Stage 2 — Appraisal accepted, final price agreed:
 *     unit moves into sellable used inventory → Dr S11-2002
 *     SHOP pays final cash difference to the customer.
 *
 * Most trade-ins go through Stage 2 directly (same-day buy-in), so the
 * template's default `inventoryAccountCode` is `'S11-2002'`. Callers that
 * need Stage 1 pass `inventoryAccountCode: 'S11-2004'` explicitly.
 *
 * JE (single SHOP entry, no FINANCE pairing):
 *
 *   Dr <inventoryAccountCode>           [tradeInPrice]
 *     Cr S11-1101 / S11-1201 (cash)     [tradeInPrice]
 *
 * Idempotency key: `tradein-${tradeInId}` (or include stage suffix when
 * the same tradeInId may move through both stages).
 */
export interface ShopTradeInInput {
  idempotencyKey: string;
  tradeInId: string;
  tradeInNumber?: string;
  cashAccountCode: string;
  tradeInPrice: Decimal;
  /**
   * Inventory account the trade-in lands in. Defaults to `'S11-2002'`
   * (used mobile, sellable). Pass `'S11-2004'` for the Stage-1 pending-
   * evaluation case where the unit is segregated from sellable stock.
   */
  inventoryAccountCode?: string;
  postedAt?: Date;
}

const DEFAULT_INVENTORY_ACCOUNT = 'S11-2002';
const ALLOWED_INVENTORY_ACCOUNTS = new Set(['S11-2002', 'S11-2004']);

@Injectable()
export class ShopTradeInTemplate {
  private readonly logger = new Logger(ShopTradeInTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

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
    const inventoryAccountCode = input.inventoryAccountCode ?? DEFAULT_INVENTORY_ACCOUNT;
    if (!ALLOWED_INVENTORY_ACCOUNTS.has(inventoryAccountCode)) {
      throw new BadRequestException(
        `ShopTradeIn: inventoryAccountCode must be S11-2002 (sellable used) or S11-2004 (pending eval); got ${inventoryAccountCode}`,
      );
    }

    const inventoryDescription =
      inventoryAccountCode === 'S11-2004'
        ? 'รับเข้าระหว่างประเมินราคา - มือถือมือสอง'
        : 'รับเข้าสต็อก - มือถือมือสอง';

    const lines: JeLineInput[] = [
      {
        accountCode: inventoryAccountCode,
        dr: price,
        cr: zero,
        description: inventoryDescription,
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

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
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
            inventoryAccountCode,
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
