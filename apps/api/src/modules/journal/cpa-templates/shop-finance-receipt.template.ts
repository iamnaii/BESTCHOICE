import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * P3-SP5 (DEEP review C1 redesign) — SHOP receives FINANCE wire.
 *
 * Trigger: FINANCE wires `financedAmount + commission` to SHOP (often
 * batched per-day / per-week). The contract has already been ACTIVATED
 * and `ShopInventoryTransferTemplate` already recognised revenue +
 * receivables. This template only books the SHOP-side cash receipt and
 * clears the matching receivable lines.
 *
 * JE (single SHOP entry):
 *
 *   Dr <bankAccountCode> (S11-12XX)        [financedAmount + commission]
 *     Cr S11-3001 (clear receivable - financed)   [financedAmount]
 *     Cr S11-3002 (clear receivable - commission) [commission]
 *
 * Balance check is trivial: Dr = financed + commission = Cr (financed +
 * commission). `createAndPost` enforces it as defense-in-depth.
 *
 * FINANCE side: existing `VendorClearanceTemplate`
 * (Dr 21-1101 + 21-1102 / Cr 11-1201). NOT posted here.
 *
 * Why this template is simple now (DEEP review C1):
 *   - The previous design tried to ALSO recognise revenue, COGS and clear
 *     the customer down-payment inside this single JE. That made the JE
 *     unbalanced and double-counted revenue between SHOP-cash-sale and
 *     SHOP-installment lifecycles.
 *   - Revenue + COGS + down clearance happen at ACTIVATION (when control
 *     transfers), not when FINANCE pays. TFRS 15.
 *   - This template now does what its name says: it receives the wire and
 *     clears the receivables.
 *
 * Idempotency: `idempotencyKey` (typically `finance-receipt-${contractId}`
 * or `finance-receipt-batch-${batchId}` when FINANCE wires multiple
 * contracts in one transfer).
 */
export interface ShopFinanceReceiptInput {
  idempotencyKey: string;
  /**
   * Either a single contractId (per-contract receipt) or a synthetic batch
   * ref (when one FINANCE wire covers many contracts).
   */
  contractId: string;
  contractNumber?: string;
  /** Bank account that received the wire — must be S11-12XX. */
  bankAccountCode: string;
  /** Amount FINANCE wired excluding commission. */
  financedAmount: Decimal;
  /** Commission portion of the wire. */
  commission: Decimal;
  postedAt?: Date;
}

@Injectable()
export class ShopFinanceReceiptTemplate {
  private readonly logger = new Logger(ShopFinanceReceiptTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopFinanceReceiptInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const financed = new Decimal(input.financedAmount.toString());
    const commission = new Decimal(input.commission.toString());

    if (financed.lt(zero) || commission.lt(zero)) {
      throw new BadRequestException(
        'ShopFinanceReceipt: financedAmount/commission cannot be negative',
      );
    }
    const total = financed.plus(commission);
    if (!total.gt(zero)) {
      throw new BadRequestException(
        'ShopFinanceReceipt: financedAmount + commission must be > 0',
      );
    }
    if (!input.bankAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopFinanceReceipt: bankAccountCode must be SHOP-side (S-prefix); got ${input.bankAccountCode}`,
      );
    }

    const lines: JeLineInput[] = [
      {
        accountCode: input.bankAccountCode,
        dr: total,
        cr: zero,
        description: 'รับเงินจาก FINANCE (ยอดจัด + ค่าคอม)',
      },
    ];
    if (financed.gt(zero)) {
      lines.push({
        accountCode: 'S11-3001',
        dr: zero,
        cr: financed,
        description: 'ล้างลูกหนี้ FINANCE - ยอดจัด',
      });
    }
    if (commission.gt(zero)) {
      lines.push({
        accountCode: 'S11-3002',
        dr: zero,
        cr: commission,
        description: 'ล้างลูกหนี้ FINANCE - ค่าคอม',
      });
    }

    // Defensive balance check (mirror of createAndPost — gives a friendlier
    // error if a future caller accidentally passes financed+commission=0
    // and skips both Cr lines).
    const sumDr = lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const sumCr = lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    if (!sumDr.equals(sumCr)) {
      throw new BadRequestException(
        `ShopFinanceReceipt: unbalanced — Dr=${sumDr.toFixed(2)} Cr=${sumCr.toFixed(2)}`,
      );
    }

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-finance-receipt' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopFinanceReceiptTemplate idempotency — JE ${existing.entryNumber} for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `รับเงิน FINANCE - สัญญา ${input.contractNumber ?? input.contractId} (SHOP)`,
          reference: `contract:${input.contractId}:finance-receipt`,
          metadata: {
            tag: 'SHOP_FINANCE_RECEIPT',
            flow: 'shop-finance-receipt',
            idempotencyKey: input.idempotencyKey,
            contractId: input.contractId,
            contractNumber: input.contractNumber ?? null,
            companyCode: 'SHOP',
            financedAmount: financed.toFixed(2),
            commission: commission.toFixed(2),
            totalReceived: total.toFixed(2),
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
