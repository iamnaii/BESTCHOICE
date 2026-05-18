import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * P3-SP5 — SHOP Cash Sale (no installment, no FINANCE involvement).
 *
 * Trigger: a Sale with method=CASH and status=COMPLETED. SHOP receives cash
 * directly from the customer and the inventory immediately leaves the SHOP
 * (FINANCE never takes title, so no ownership transfer JE).
 *
 * JE (single SHOP entry — `journal.createAndPost` is enough; no Paired wrap):
 *
 *   Dr S11-1101 / S11-1201 (cash or bank account)   [salePrice]
 *     Cr S41-1101 / S41-1102 / S41-1103 (revenue)   [salePrice]
 *
 *   Dr S50-1101 / S50-1102 / S50-1103 (COGS)        [costPrice]
 *     Cr S11-2001 / S11-2002 / S11-2003 (inventory) [costPrice]
 *
 * SHOP is NOT VAT-registered (per CLAUDE.md: BESTCHOICE SHOP ไม่จด VAT) so
 * there is no 21-21XX line on the SHOP side regardless of product category.
 *
 * Caller responsibilities:
 *   - Pick the right S41-11XX revenue code based on product type
 *     (new mobile / used mobile / accessory).
 *   - Pick the matching S50-11XX COGS code and S11-20XX inventory code.
 *   - Compute costPrice from weighted-average or FIFO (out of scope for the
 *     template — the template just posts whatever the caller hands it).
 *   - Pass `idempotencyKey` (typically `sale-${saleId}`) so re-runs of the
 *     same Sale don't double-post.
 */
export interface ShopCashSaleInput {
  /** Idempotency anchor — usually `sale-${saleId}`. */
  idempotencyKey: string;
  saleId: string;
  saleNumber?: string;
  /** Where the cash landed. S11-1101..1103 (per-branch cash) or S11-1201/1202 (bank). */
  cashAccountCode: string;
  /** Revenue line — typically S41-1101, S41-1102, or S41-1103. */
  revenueAccountCode: string;
  revenueAmount: Decimal;
  /** COGS line — S50-1101, S50-1102, or S50-1103. */
  cogsAccountCode: string;
  /** Inventory clearing — S11-2001, S11-2002, S11-2003. */
  inventoryAccountCode: string;
  inventoryCost: Decimal;
  postedAt?: Date;
  /** Optional override of the description suffix shown on the JE. */
  description?: string;
}

@Injectable()
export class ShopCashSaleTemplate {
  private readonly logger = new Logger(ShopCashSaleTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  private assertShopCode(code: string, label: string): void {
    if (!code.startsWith('S')) {
      throw new BadRequestException(
        `ShopCashSale: ${label} must be a SHOP-side account (S-prefix); got ${code}`,
      );
    }
  }

  async execute(
    input: ShopCashSaleInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const revenue = new Decimal(input.revenueAmount.toString());
    const cost = new Decimal(input.inventoryCost.toString());
    if (!revenue.gt(zero)) {
      throw new BadRequestException('ShopCashSale: revenueAmount must be > 0');
    }
    if (cost.lt(zero)) {
      throw new BadRequestException('ShopCashSale: inventoryCost cannot be negative');
    }

    this.assertShopCode(input.cashAccountCode, 'cashAccountCode');
    this.assertShopCode(input.revenueAccountCode, 'revenueAccountCode');
    this.assertShopCode(input.cogsAccountCode, 'cogsAccountCode');
    this.assertShopCode(input.inventoryAccountCode, 'inventoryAccountCode');

    const lines: JeLineInput[] = [
      { accountCode: input.cashAccountCode, dr: revenue, cr: zero, description: 'รับเงินสด ขายหน้าร้าน' },
      { accountCode: input.revenueAccountCode, dr: zero, cr: revenue, description: 'รายได้ขายหน้าร้าน' },
    ];
    // COGS pair is optional only if cost is 0 (e.g. promotional give-away).
    if (cost.gt(zero)) {
      lines.push({ accountCode: input.cogsAccountCode, dr: cost, cr: zero, description: 'ต้นทุนขาย' });
      lines.push({
        accountCode: input.inventoryAccountCode,
        dr: zero,
        cr: cost,
        description: 'ตัดสต็อก',
      });
    }

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      // Idempotency probe — match by metadata.flow + metadata.idempotencyKey.
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-cash-sale' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopCashSaleTemplate idempotency — JE ${existing.entryNumber} already exists for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);

      const result = await this.journal.createAndPost(
        {
          description:
            input.description ??
            `ขายเงินสด ${input.saleNumber ?? input.saleId} (SHOP)`,
          reference: `sale:${input.saleId}`,
          metadata: {
            tag: 'SHOP_CASH_SALE',
            flow: 'shop-cash-sale',
            idempotencyKey: input.idempotencyKey,
            saleId: input.saleId,
            saleNumber: input.saleNumber ?? null,
            companyCode: 'SHOP',
            revenueAmount: revenue.toFixed(2),
            inventoryCost: cost.toFixed(2),
            grossProfit: revenue.sub(cost).toFixed(2),
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
