import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

export interface ShopExchangeReturnInput {
  oldProductId: string;
  oldContractId: string;
  /** Cost basis of the returning device (Product.costPrice). Must be > 0. */
  cost: Decimal;
}

/**
 * Exchange A.4 — SHOP re-intake of the returned (old) device.
 *
 * Inverse of `ShopInventoryTransferTemplate`'s COGS leg. When the customer
 * surrenders the old device in a same-price exchange, the device legally
 * moves back into SHOP's inventory (ownership flips FINANCE → SHOP in the
 * Product row), and the books need a mirror SHOP-side entry:
 *
 *   Dr S11-2002 (used inventory)   [costPrice]
 *     Cr S50-1102 (used-COGS)      [costPrice]
 *
 * The cost basis is the original Product.costPrice — the same value
 * `ShopInventoryTransferTemplate` debited to S50-1102 when the device first
 * left SHOP. Reversing at the same value keeps the COGS account net-zero for
 * the device's round trip (sold-then-returned).
 *
 * The Product.ownedByCompanyId flip is owner by the calling service, NOT
 * this template, because it touches a non-accounting column and the caller
 * already has a `tx.product.update` for the status change.
 *
 * Idempotency: `metadata.flow = 'shop-exchange-return'` + `metadata.idempotencyKey
 * = <oldProductId>:<oldContractId>` (one re-intake per product per contract).
 * The journal_entries_idempotency_idx partial unique index enforces this at
 * the DB level.
 */
@Injectable()
export class ShopExchangeReturnTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopExchangeReturnInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const cost = new Decimal(input.cost.toString());
    if (cost.lte(0)) {
      // Defense in depth — the caller should have already rejected this with
      // a clearer Thai message. If we reach this branch it's a programmer error.
      throw new InternalServerErrorException(
        'ShopExchangeReturn: cost must be > 0 (received ' + cost.toString() + ')',
      );
    }
    const zero = new Decimal(0);
    const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
    const idempotencyKey = `${input.oldProductId}:${input.oldContractId}`;

    return this.journal.createAndPost(
      {
        description: `Exchange A.4 — re-intake used device to SHOP inventory (product ${input.oldProductId})`,
        reference: `contract:${input.oldContractId}:exchange-return`,
        metadata: {
          flow: 'shop-exchange-return',
          idempotencyKey,
          oldProductId: input.oldProductId,
          oldContractId: input.oldContractId,
          companyCode: 'SHOP',
          cost: cost.toFixed(2),
        },
        companyId: shopCompanyId,
        lines: [
          {
            accountCode: 'S11-2002',
            dr: cost,
            cr: zero,
            description: 'รับเครื่องเก่ากลับเข้าสต็อก SHOP (มือสอง)',
          },
          {
            accountCode: 'S50-1102',
            dr: zero,
            cr: cost,
            description: 'กลับรายการต้นทุนขาย (เครื่องเดิมคืนสต็อก)',
          },
        ],
      },
      tx,
    );
  }
}
