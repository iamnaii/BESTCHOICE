import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

export interface ShopCollectSettlementInput {
  contractId: string;
  /** Cash/bank account that receives the remittance from the shop (must be in CASH_ACCOUNT_CODES). */
  depositAccountCode: string;
  /** Amount to settle — must be ≤ outstanding 11-2107 balance + 0.01 tolerance. */
  amount: number | Decimal;
  postedById?: string;
}

/**
 * Shop-Collect Settlement — clears the Dr 11-2107 receivable created by a
 * `collectedByShop` early payoff when the shop remits the collected cash to FINANCE.
 *
 * JE:
 *   Dr depositAccountCode [amount]   (cash/bank received from shop)
 *     Cr 11-2107 ลูกหนี้-หน้าร้าน    [amount]
 *
 * This is a CASH RECEIPT (Dr asset / Cr asset), NOT a vendor-clearance
 * (which is Dr liability / Cr cash).
 *
 * Guards:
 *   - depositAccountCode must be in CASH_ACCOUNT_CODES
 *   - outstanding 11-2107 (ΣDr − ΣCr over metadata.contractId) must be > 0
 *   - amount must be ≤ outstanding + 0.01 (over-settle rejected)
 *
 * Idempotency: via metadata flow='shop-collect-settlement' + contractId + amount
 * (mirrors the existing template idempotency pattern across this codebase).
 */
@Injectable()
export class ShopCollectSettlementTemplate {
  private readonly logger = new Logger(ShopCollectSettlementTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ShopCollectSettlementInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const { contractId, depositAccountCode } = input;
    const amount = new Decimal(input.amount.toString());

    // ── Validate deposit account ──────────────────────────────────────────────
    if (!(CASH_ACCOUNT_CODES as readonly string[]).includes(depositAccountCode)) {
      throw new BadRequestException(
        `บัญชีรับเงิน "${depositAccountCode}" ไม่ถูกต้อง — ต้องเป็นหนึ่งใน ${CASH_ACCOUNT_CODES.join(', ')}`,
      );
    }

    const client = outerTx ?? this.prisma;

    // ── Compute outstanding 11-2107 for this contract ─────────────────────────
    // Sum all POSTED JL lines (Dr − Cr) where parentJE.metadata.contractId = contractId
    const lines = await client.journalLine.findMany({
      where: {
        accountCode: '11-2107',
        journalEntry: {
          AND: [
            { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
            { status: 'POSTED' },
            { deletedAt: null },
          ],
        },
      },
      select: { debit: true, credit: true },
    });

    const totalDr = lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    const outstanding = totalDr.minus(totalCr);

    if (outstanding.lte(0)) {
      throw new BadRequestException(
        `ไม่มียอด 11-2107 ค้างชำระสำหรับสัญญา ${contractId} (ยอดคงเหลือ = ${outstanding.toFixed(2)})`,
      );
    }

    // ── Over-settle guard ─────────────────────────────────────────────────────
    if (amount.gt(outstanding.plus('0.01'))) {
      throw new BadRequestException(
        `ยอดชำระ ${amount.toFixed(2)} ฿ เกินกว่ายอดค้าง ${outstanding.toFixed(2)} ฿ ไม่อนุญาต`,
      );
    }

    // ── Idempotency check ─────────────────────────────────────────────────────
    const existing = await client.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['amount'], equals: amount.toFixed(2) } } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });

    if (existing) {
      this.logger.log(
        `[SCS] ShopCollectSettlement idempotency — JE ${existing.entryNumber} already exists for contract ${contractId} amount=${amount.toFixed(2)}, skipping`,
      );
      return { entryNo: existing.entryNumber };
    }

    const zero = new Decimal(0);

    // ── Post Dr cash / Cr 11-2107 ─────────────────────────────────────────────
    const result = await this.journal.createAndPost(
      {
        description: `รับโอนจากหน้าร้าน — สัญญา ${contractId.slice(0, 8)} (ล้าง 11-2107)`,
        reference: `${contractId}:shop-collect-settlement`,
        metadata: {
          tag: 'SCS',
          flow: 'shop-collect-settlement',
          contractId,
          amount: amount.toFixed(2),
          depositAccountCode,
          idempotencyKey: `${contractId}:${amount.toFixed(2)}`,
        },
        lines: [
          {
            accountCode: depositAccountCode,
            dr: amount,
            cr: zero,
            description: `รับโอนจากหน้าร้าน ${amount.toFixed(2)} ฿`,
          },
          {
            accountCode: '11-2107',
            dr: zero,
            cr: amount,
            description: 'ล้างลูกหนี้-หน้าร้าน (shop-collect)',
          },
        ],
      },
      outerTx,
    );

    return { entryNo: result.entryNumber };
  }
}
