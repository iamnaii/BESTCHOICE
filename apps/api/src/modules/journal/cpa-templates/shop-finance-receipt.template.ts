import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * P3-SP5 — SHOP receives FINANCE wire (financedAmount + commission).
 *
 * Trigger: FINANCE wires the financed-amount + commission to SHOP (often
 * batched per-day). At this point:
 *   - The down-payment already booked at SHOP (via `ShopDownPaymentTemplate`)
 *     is cleared from S21-2001 into S41-11XX revenue.
 *   - The financed-amount portion lands in SHOP's bank.
 *   - The commission (% of yodjat) is recognised as inter-company income on
 *     S41-1201.
 *   - The inventory item leaves SHOP's stock (ownership transferred to
 *     FINANCE — paired via `ShopInventoryTransferToFinanceTemplate`, NOT in
 *     this template).
 *
 * The FINANCE side of this same business event is the existing
 * `VendorClearanceTemplate` (Dr 21-1101 + 21-1102 / Cr 11-1201). DO NOT
 * re-post FINANCE here — VendorClearanceTemplate is the source of truth for
 * the FINANCE side. This template only books the SHOP-side mirror.
 *
 * JE (single SHOP entry):
 *
 *   Dr S11-1201 (bank-SHOP)                 [financedAmount + commission]
 *   Dr S21-2001 (clear down-payment)        [downAmount]
 *     Cr S11-3001 (FINANCE-receivable principal)  [financedAmount]
 *     Cr S11-3002 (FINANCE-receivable commission) [commission]
 *     Cr S41-1101 / S41-1102 (revenue-mobile)      [salePrice]
 *     Cr S41-1201 (commission income from FINANCE) [commission]
 *
 *   Dr S50-1101 / S50-1102 (COGS)                     [costPrice]
 *     Cr S11-2001 / S11-2002 (inventory)              [costPrice]
 *
 * Where:
 *   - salePrice = downAmount + financedAmount
 *   - bank receipt = financedAmount + commission
 *   - The 4 Cr lines net to: financedAmount + commission + downAmount
 *     which equals salePrice + commission — matches the two Dr lines
 *     (financedAmount+commission for bank, downAmount for clearing).
 *
 * Caller responsibilities (typically `contracts.service` on FINANCE-paid):
 *   - Pass real salePrice + downAmount + financedAmount + commission so the
 *     balance check passes.
 *   - Pick correct S41-11XX revenue + S50-11XX COGS + S11-20XX inventory
 *     codes based on product type (new mobile / used mobile / accessory).
 *   - Pass `idempotencyKey` (typically `finance-receipt-${contractId}`).
 */
export interface ShopFinanceReceiptInput {
  idempotencyKey: string;
  contractId: string;
  contractNumber?: string;
  /** Amount FINANCE actually wired to SHOP bank account. */
  bankAccountCode: string;
  /** Sale price = downAmount + financedAmount. */
  salePrice: Decimal;
  downAmount: Decimal;
  financedAmount: Decimal;
  commission: Decimal;
  revenueAccountCode: string; // S41-1101 / S41-1102
  cogsAccountCode: string; // S50-1101 / S50-1102
  inventoryAccountCode: string; // S11-2001 / S11-2002
  inventoryCost: Decimal;
  postedAt?: Date;
}

@Injectable()
export class ShopFinanceReceiptTemplate {
  private readonly logger = new Logger(ShopFinanceReceiptTemplate.name);
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
    input: ShopFinanceReceiptInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const salePrice = new Decimal(input.salePrice.toString());
    const down = new Decimal(input.downAmount.toString());
    const financed = new Decimal(input.financedAmount.toString());
    const commission = new Decimal(input.commission.toString());
    const cost = new Decimal(input.inventoryCost.toString());

    // Invariant: down + financed must equal salePrice.
    if (!down.plus(financed).equals(salePrice)) {
      throw new BadRequestException(
        `ShopFinanceReceipt: down + financed (${down.plus(financed).toFixed(2)}) must equal salePrice (${salePrice.toFixed(2)})`,
      );
    }
    if (!salePrice.gt(zero)) {
      throw new BadRequestException('ShopFinanceReceipt: salePrice must be > 0');
    }
    if (commission.lt(zero) || cost.lt(zero)) {
      throw new BadRequestException('ShopFinanceReceipt: commission/cost cannot be negative');
    }
    for (const [code, label] of [
      [input.bankAccountCode, 'bankAccountCode'],
      [input.revenueAccountCode, 'revenueAccountCode'],
      [input.cogsAccountCode, 'cogsAccountCode'],
      [input.inventoryAccountCode, 'inventoryAccountCode'],
    ] as const) {
      if (!code.startsWith('S')) {
        throw new BadRequestException(
          `ShopFinanceReceipt: ${label} must be SHOP-side (S-prefix); got ${code}`,
        );
      }
    }

    const lines: JeLineInput[] = [
      // Dr bank — FINANCE wire (financed + commission). Down already in bank.
      {
        accountCode: input.bankAccountCode,
        dr: financed.plus(commission),
        cr: zero,
        description: 'รับเงินจาก FINANCE (ยอดจัด + ค่าคอม)',
      },
      // Dr S21-2001 — clear the down-payment payable booked at down receipt
      {
        accountCode: 'S21-2001',
        dr: down,
        cr: zero,
        description: 'ล้างเงินรับล่วงหน้า (เงินดาวน์)',
      },
      // Cr S11-3001 — collect FINANCE receivable principal
      {
        accountCode: 'S11-3001',
        dr: zero,
        cr: financed,
        description: 'ล้างลูกหนี้ FINANCE - ยอดจัด',
      },
      // Cr S11-3002 — collect FINANCE receivable commission
      {
        accountCode: 'S11-3002',
        dr: zero,
        cr: commission,
        description: 'ล้างลูกหนี้ FINANCE - ค่าคอม',
      },
      // Cr revenue — full salePrice
      {
        accountCode: input.revenueAccountCode,
        dr: zero,
        cr: salePrice,
        description: 'รายได้ขายเครื่อง (ผ่อน)',
      },
      // Cr commission income
      {
        accountCode: 'S41-1201',
        dr: zero,
        cr: commission,
        description: 'รายได้ค่าคอมจาก FINANCE',
      },
    ];

    // COGS pair if cost > 0.
    if (cost.gt(zero)) {
      lines.push({
        accountCode: input.cogsAccountCode,
        dr: cost,
        cr: zero,
        description: 'ต้นทุนขาย',
      });
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

      const shopCompanyId = await this.getShopCompanyId(tx);
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
            salePrice: salePrice.toFixed(2),
            downAmount: down.toFixed(2),
            financedAmount: financed.toFixed(2),
            commission: commission.toFixed(2),
            inventoryCost: cost.toFixed(2),
            grossProfit: salePrice.add(commission).sub(cost).toFixed(2),
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
