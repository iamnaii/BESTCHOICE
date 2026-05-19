import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * P3-SP5 (DEEP review C1+C2 redesign) — Contract activation, SHOP side.
 *
 * Trigger: installment contract becomes ACTIVATED. Ownership of the device
 * moves from SHOP's stock into FINANCE's collateral pool, and SHOP
 * recognises the full sale at activation (TFRS 15 timing — revenue at
 * point in time, when control transfers, not later when FINANCE wires
 * cash).
 *
 * This template replaces the broken "single-JE" design that mixed
 * inventory write-off with the receivable / revenue recognition. The new
 * design posts TWO balanced JEs inside ONE `$transaction` so both halves
 * succeed atomically:
 *
 *   JE A — COGS recognition (inventory leaves SHOP):
 *     Dr <cogsAccountCode>          [costPrice]
 *       Cr <inventoryAccountCode>   [costPrice]
 *
 *   JE B — Revenue + receivable recognition (down already on books):
 *     Dr S11-3001 (FINANCE receivable — yodjat)         [financedAmount]
 *     Dr S11-3002 (FINANCE receivable — commission)     [commission]
 *     Dr S21-2001 (clear down-payment liability)        [downAmount]
 *       Cr <revenueAccountCode>                         [salePrice]
 *       Cr S41-1201 (commission income from FINANCE)    [commission]
 *
 * Balance check (JE B):
 *   Dr = financedAmount + commission + downAmount
 *   Cr = salePrice + commission
 *   → financedAmount + downAmount must equal salePrice (financing identity)
 *
 * The template ASSERTS this identity up front. If a caller passes
 * inconsistent numbers a `BadRequestException` is thrown BEFORE either JE
 * touches the ledger.
 *
 * Why the down-payment liability is cleared HERE (not in
 * ShopFinanceReceiptTemplate as the previous design did):
 *   - The customer paid the down BEFORE contract activation
 *     (`ShopDownPaymentTemplate` booked Dr cash / Cr S21-2001).
 *   - At ACTIVATION the sale is complete and revenue is earned, so the
 *     "advance from customer" liability must be reclassified into revenue.
 *   - Booking it in the FINANCE-receipt template was incorrect because
 *     FINANCE's wire to SHOP has nothing to do with the customer's down.
 *
 * Pairs with `ShopFinanceReceiptTemplate` which now becomes a simple
 * cash-in / receivable-clearance posting when FINANCE actually wires the
 * money (which may be the same day as activation, or days later batched).
 *
 * FINANCE-side bookings:
 *   - `ContractActivation1ATemplate` already posts Dr 11-2101 / Cr 21-1101
 *     etc. on the FINANCE side at activation — that handles the FINANCE
 *     books. This template only books the SHOP mirror.
 *
 * Idempotency: a single `metadata.idempotencyKey` (typically
 * `activation-${contractId}`) is stamped on BOTH JE A and JE B; both
 * carry the same `metadata.batchId` so audit reports can pair them.
 */
export interface ShopInventoryTransferInput {
  idempotencyKey: string;
  contractId: string;
  contractNumber?: string;
  productId: string;
  productName?: string;
  /** S11-2001 (new) / S11-2002 (used) / S11-2003 (accessory). */
  inventoryAccountCode: string;
  /** Matching COGS code S50-1101 / 1102 / 1103. */
  cogsAccountCode: string;
  /** Revenue code S41-1101 / 1102 / 1103. */
  revenueAccountCode: string;
  /** Cost basis from weighted-average / FIFO at activation time. */
  costPrice: Decimal;
  /** Total sale price = downAmount + financedAmount. Asserted. */
  salePrice: Decimal;
  /** Down already paid into SHOP via ShopDownPaymentTemplate. */
  downAmount: Decimal;
  /** Amount FINANCE will eventually wire to SHOP (excl. commission). */
  financedAmount: Decimal;
  /** Commission FINANCE pays SHOP on top of financed amount. */
  commission: Decimal;
  postedAt?: Date;
}

export interface ShopInventoryTransferResult {
  /** Shared batchId between cogs + revenue JEs. */
  batchId: string;
  cogsEntryNo: string;
  cogsJournalEntryId: string;
  revenueEntryNo: string;
  revenueJournalEntryId: string;
}

@Injectable()
export class ShopInventoryTransferTemplate {
  private readonly logger = new Logger(ShopInventoryTransferTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  private assertShopCode(code: string, label: string): void {
    if (!code.startsWith('S')) {
      throw new BadRequestException(
        `ShopInventoryTransfer: ${label} must be SHOP-side (S-prefix); got ${code}`,
      );
    }
  }

  async execute(
    input: ShopInventoryTransferInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<ShopInventoryTransferResult> {
    const zero = new Decimal(0);
    const cost = new Decimal(input.costPrice.toString());
    const salePrice = new Decimal(input.salePrice.toString());
    const down = new Decimal(input.downAmount.toString());
    const financed = new Decimal(input.financedAmount.toString());
    const commission = new Decimal(input.commission.toString());

    // ── input validation ────────────────────────────────────────────────
    if (!salePrice.gt(zero)) {
      throw new BadRequestException('ShopInventoryTransfer: salePrice must be > 0');
    }
    if (cost.lte(zero)) {
      throw new BadRequestException('ShopInventoryTransfer: costPrice must be > 0');
    }
    if (down.lt(zero) || financed.lt(zero) || commission.lt(zero)) {
      throw new BadRequestException(
        'ShopInventoryTransfer: down/financed/commission cannot be negative',
      );
    }
    this.assertShopCode(input.inventoryAccountCode, 'inventoryAccountCode');
    this.assertShopCode(input.cogsAccountCode, 'cogsAccountCode');
    this.assertShopCode(input.revenueAccountCode, 'revenueAccountCode');

    // Financing identity: down + financed must equal sale price. Without
    // this, JE B becomes unbalanced and the createAndPost will throw with a
    // less helpful error.
    const sumDownFinanced = down.plus(financed);
    if (!sumDownFinanced.equals(salePrice)) {
      throw new BadRequestException(
        `ShopInventoryTransfer: down (${down.toFixed(2)}) + financed (${financed.toFixed(2)}) = ${sumDownFinanced.toFixed(2)} must equal salePrice (${salePrice.toFixed(2)})`,
      );
    }

    // ── JE A: COGS recognition ──────────────────────────────────────────
    const cogsLines: JeLineInput[] = [
      {
        accountCode: input.cogsAccountCode,
        dr: cost,
        cr: zero,
        description: 'ต้นทุนขาย (ผ่อน)',
      },
      {
        accountCode: input.inventoryAccountCode,
        dr: zero,
        cr: cost,
        description: 'ตัดสต็อก โอนกรรมสิทธิ์ → FINANCE',
      },
    ];

    // ── JE B: revenue + receivables + down clearance ────────────────────
    const revenueLines: JeLineInput[] = [];
    if (financed.gt(zero)) {
      revenueLines.push({
        accountCode: 'S11-3001',
        dr: financed,
        cr: zero,
        description: 'ลูกหนี้ FINANCE - ยอดจัด',
      });
    }
    if (commission.gt(zero)) {
      revenueLines.push({
        accountCode: 'S11-3002',
        dr: commission,
        cr: zero,
        description: 'ลูกหนี้ FINANCE - ค่าคอม',
      });
    }
    if (down.gt(zero)) {
      revenueLines.push({
        accountCode: 'S21-2001',
        dr: down,
        cr: zero,
        description: 'ล้างเงินรับล่วงหน้า (เงินดาวน์)',
      });
    }
    revenueLines.push({
      accountCode: input.revenueAccountCode,
      dr: zero,
      cr: salePrice,
      description: 'รายได้ขายเครื่อง (ผ่อน)',
    });
    if (commission.gt(zero)) {
      revenueLines.push({
        accountCode: 'S41-1201',
        dr: zero,
        cr: commission,
        description: 'รายได้ค่าคอมจาก FINANCE',
      });
    }

    // ── execution: idempotent, both JEs in one $transaction ─────────────
    const productLabel = input.productName ?? input.productId;
    const contractLabel = input.contractNumber ?? input.contractId;
    const descCogs = `ต้นทุนขาย ${productLabel} (สัญญา ${contractLabel})`;
    const descRevenue = `รับรู้รายได้ขายผ่อน ${productLabel} (สัญญา ${contractLabel})`;
    const batchId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const exec = async (
      tx: Prisma.TransactionClient,
    ): Promise<ShopInventoryTransferResult> => {
      // Idempotency: probe both COGS and revenue legs by idempotencyKey.
      // We treat the COGS leg as the canonical anchor — if it exists we
      // also fetch the matching revenue leg via metadata.batchId.
      const existingCogs = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-inventory-transfer-cogs' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existingCogs) {
        const existingBatchId = (existingCogs.metadata as { batchId?: string } | null)?.batchId;
        const existingRevenue = existingBatchId
          ? await tx.journalEntry.findFirst({
              where: {
                AND: [
                  {
                    metadata: { path: ['flow'], equals: 'shop-inventory-transfer-revenue' } as any,
                  },
                  { metadata: { path: ['batchId'], equals: existingBatchId } as any },
                ],
                deletedAt: null,
              },
            })
          : null;
        if (!existingRevenue) {
          // Shouldn't happen — both posted in single $tx. If it does, the
          // previous attempt was partial; refuse to silently return stale.
          throw new BadRequestException(
            `ShopInventoryTransfer: COGS leg found for idempotencyKey=${input.idempotencyKey} but revenue leg missing (batchId=${existingBatchId})`,
          );
        }
        this.logger.log(
          `ShopInventoryTransferTemplate idempotency — batchId=${existingBatchId} cogs=${existingCogs.entryNumber} rev=${existingRevenue.entryNumber}`,
        );
        return {
          batchId: existingBatchId ?? '',
          cogsEntryNo: existingCogs.entryNumber,
          cogsJournalEntryId: existingCogs.id,
          revenueEntryNo: existingRevenue.entryNumber,
          revenueJournalEntryId: existingRevenue.id,
        };
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const postedAt = input.postedAt ?? new Date();

      const cogsResult = await this.journal.createAndPost(
        {
          description: descCogs,
          reference: `contract:${input.contractId}:inventory-transfer:cogs`,
          metadata: {
            tag: 'SHOP_INVENTORY_TRANSFER_COGS',
            flow: 'shop-inventory-transfer-cogs',
            idempotencyKey: input.idempotencyKey,
            batchId,
            contractId: input.contractId,
            contractNumber: input.contractNumber ?? null,
            productId: input.productId,
            productName: input.productName ?? null,
            companyCode: 'SHOP',
            costPrice: cost.toFixed(2),
            inventoryAccountCode: input.inventoryAccountCode,
            cogsAccountCode: input.cogsAccountCode,
          },
          postedAt,
          companyId: shopCompanyId,
          lines: cogsLines,
        },
        tx,
      );

      const revenueResult = await this.journal.createAndPost(
        {
          description: descRevenue,
          reference: `contract:${input.contractId}:inventory-transfer:revenue`,
          metadata: {
            tag: 'SHOP_INVENTORY_TRANSFER_REVENUE',
            flow: 'shop-inventory-transfer-revenue',
            // intentionally NOT using idempotencyKey here so the COGS-leg
            // probe is the single source of truth — revenue is tied via
            // batchId only.
            batchId,
            cogsJournalEntryId: cogsResult.id,
            contractId: input.contractId,
            contractNumber: input.contractNumber ?? null,
            productId: input.productId,
            companyCode: 'SHOP',
            salePrice: salePrice.toFixed(2),
            downAmount: down.toFixed(2),
            financedAmount: financed.toFixed(2),
            commission: commission.toFixed(2),
            revenueAccountCode: input.revenueAccountCode,
          },
          postedAt,
          companyId: shopCompanyId,
          lines: revenueLines,
        },
        tx,
      );

      return {
        batchId,
        cogsEntryNo: cogsResult.entryNumber,
        cogsJournalEntryId: cogsResult.id,
        revenueEntryNo: revenueResult.entryNumber,
        revenueJournalEntryId: revenueResult.id,
      };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
