import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * P3-SP5 — Inventory Transfer SHOP → FINANCE on installment contract activation.
 *
 * Trigger: contract becomes ACTIVATED. Ownership of the device moves from
 * SHOP's stock into FINANCE's collateral pool (until customer pays off).
 *
 * JE (SHOP side only — SEE COMMENT BELOW for why not paired):
 *
 *   Dr S11-3001 (FINANCE-receivable principal)   [transferPrice]
 *     Cr S11-2001 / S11-2002 (inventory)         [transferPrice]
 *
 * Why SHOP-only and not paired through PairedJournalService:
 *
 * The existing `ContractActivation1ATemplate` ALREADY posts the FINANCE side
 * of this business event:
 *     Dr 11-2101 (HP receivable Gross)
 *       Cr 21-1101 (เจ้าหนี้-หน้าร้าน, yodjat owed to SHOP)
 *       Cr 21-1102 (เจ้าหนี้ค่าคอม)
 *       Cr 21-2102 (VAT deferred)
 *       Cr 11-2106 (unearned interest)
 *
 * The Cr 21-1101 there IS the FINANCE-side recognition of "we now owe SHOP
 * for taking ownership of this device". Posting it again here would double-
 * book the AP. So in the current Phase 3 state, this template ONLY closes
 * the SHOP inventory line and recognises the SHOP receivable mirroring
 * 21-1101. Two parallel JEs (SHOP-only here + FINANCE-only in
 * ContractActivation1A) but the two halves are still reconciled by sharing
 * `metadata.contractId`.
 *
 * Future P3-SP7 split: when SHOP and FINANCE become separate legal entities
 * with separate databases, ContractActivation1A's FINANCE side stays, and
 * this template publishes the SHOP-side mirror through the same paired
 * mechanism (paired-journal.service or an event bus). Until then this
 * template ships SHOP-only.
 *
 * Idempotency: `inventory-transfer-${contractId}-${productId}`.
 */
export interface ShopInventoryTransferInput {
  idempotencyKey: string;
  contractId: string;
  contractNumber?: string;
  productId: string;
  productName?: string;
  /** S11-2001 (new) / S11-2002 (used) / S11-2003 (accessory). */
  inventoryAccountCode: string;
  transferPrice: Decimal;
  postedAt?: Date;
}

@Injectable()
export class ShopInventoryTransferTemplate {
  private readonly logger = new Logger(ShopInventoryTransferTemplate.name);
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
    input: ShopInventoryTransferInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const price = new Decimal(input.transferPrice.toString());
    if (!price.gt(zero)) {
      throw new BadRequestException('ShopInventoryTransfer: transferPrice must be > 0');
    }
    if (!input.inventoryAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopInventoryTransfer: inventoryAccountCode must be SHOP-side (S-prefix); got ${input.inventoryAccountCode}`,
      );
    }

    const lines: JeLineInput[] = [
      {
        accountCode: 'S11-3001',
        dr: price,
        cr: zero,
        description: 'ลูกหนี้ FINANCE - ยอดจัด (โอนกรรมสิทธิ์)',
      },
      {
        accountCode: input.inventoryAccountCode,
        dr: zero,
        cr: price,
        description: 'ตัดสต็อก โอนกรรมสิทธิ์ → FINANCE',
      },
    ];

    const desc = `ย้ายกรรมสิทธิ์ ${input.productName ?? input.productId} → FINANCE (สัญญา ${input.contractNumber ?? input.contractId})`;

    const exec = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-inventory-transfer' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopInventoryTransferTemplate idempotency — JE ${existing.entryNumber} for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const shopCompanyId = await this.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: desc,
          reference: `contract:${input.contractId}:inventory-transfer`,
          metadata: {
            tag: 'SHOP_INVENTORY_TRANSFER',
            flow: 'shop-inventory-transfer',
            idempotencyKey: input.idempotencyKey,
            contractId: input.contractId,
            contractNumber: input.contractNumber ?? null,
            productId: input.productId,
            productName: input.productName ?? null,
            companyCode: 'SHOP',
            transferPrice: price.toFixed(2),
            inventoryAccountCode: input.inventoryAccountCode,
          },
          postedAt: input.postedAt ?? new Date(),
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
