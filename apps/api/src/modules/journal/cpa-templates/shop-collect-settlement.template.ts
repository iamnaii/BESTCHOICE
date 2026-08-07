import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
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
  /**
   * Client-generated UUID ต่อการกดยืนยันหนึ่งครั้ง — dedupe เฉพาะ retry ของคำขอเดิม
   * โดยไม่กลืนการโอนซ้ำยอดเท่ากันที่ตั้งใจ. ไม่ส่ง = fallback dedupe แบบเก่า
   * (contractId+amount) เพื่อ backward compat กับ caller เดิม.
   */
  requestId?: string;
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
 * Idempotency:
 *   - Preferred: metadata flow='shop-collect-settlement' + requestId (client-
 *     generated UUID, one per dialog-open). Dedupes ONLY retries of the exact
 *     same request — two intentional remittances of the same amount (e.g. two
 *     separate ฿2,500 transfers) each get their own JE.
 *   - Legacy fallback (requestId omitted): metadata flow + contractId + amount
 *     (mirrors the existing template idempotency pattern across this
 *     codebase) — kept for backward compat with callers that haven't been
 *     updated to send requestId yet. This fallback CANNOT distinguish two
 *     intentional same-amount remittances from a retry — it swallows the
 *     second one.
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

    // ── requestId idempotency (เช็คก่อน guard อื่นทั้งหมด) ─────────────────────
    // Checked BEFORE the outstanding computation so a retry that lands AFTER the
    // 11-2107 balance has already been fully cleared (by the first call) still
    // returns the original idempotent success instead of tripping the
    // no-balance guard below.
    if (input.requestId) {
      const dupe = await client.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as Prisma.JournalEntryWhereInput,
            { metadata: { path: ['requestId'], equals: input.requestId } } as Prisma.JournalEntryWhereInput,
          ],
          deletedAt: null,
        },
      });
      if (dupe) {
        const amountStr = amount.toFixed(2);
        const dupeMetadata = dupe.metadata as Record<string, unknown> | null;
        const bookedAmount = dupeMetadata?.['amount'];
        const isSameAmount = typeof bookedAmount === 'string' && bookedAmount === amountStr;

        if (!isSameAmount) {
          // ยอดเปลี่ยนไปจากตอนโพสต์ JE เดิม (หรืออ่าน metadata ไม่ได้) — ห้ามกลืนเงียบ
          // ต้องปฏิเสธ ไม่ใช่คืน success ของยอดเก่าให้ operator เข้าใจผิดว่ายอดใหม่บันทึกแล้ว
          const bookedDisplay = typeof bookedAmount === 'string' ? bookedAmount : 'ไม่ทราบยอด';
          this.logger.warn(
            `[SCS] requestId ${input.requestId} matched JE ${dupe.entryNumber} but amount differs (booked=${bookedDisplay}, incoming=${amountStr}) — rejecting`,
          );
          throw new ConflictException(
            `คำขอนี้ถูกบันทึกไปแล้วที่ยอด ${bookedDisplay} ฿ — กรุณาปิดหน้าต่างรับโอนแล้วเปิดใหม่ หากต้องการบันทึกยอดใหม่`,
          );
        }

        this.logger.log(
          `[SCS] duplicate requestId ${input.requestId} — JE ${dupe.entryNumber} already posted, skipping`,
        );
        return { entryNo: dupe.entryNumber };
      }
    }

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

    // ── Legacy idempotency (เฉพาะ caller เก่าที่ไม่ส่ง requestId) ─────────────
    if (!input.requestId) {
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
    }

    const zero = new Decimal(0);

    // ── Post Dr cash / Cr 11-2107 ─────────────────────────────────────────────
    // `reference` feeds a project-wide UNIQUE index on (referenceType,
    // referenceId) — it must stay unique per JE. The legacy reference string
    // (contractId+amount) is intentionally identical across two same-amount
    // calls, which is exactly what the old (contractId, amount) dedupe relied
    // on. Once requestId is present, fold it into `reference` too so two
    // intentionally-equal-amount remittances don't collide on that index.
    const result = await this.journal.createAndPost(
      {
        description: `รับโอนจากหน้าร้าน — สัญญา ${contractId.slice(0, 8)} (ล้าง 11-2107)`,
        reference: input.requestId
          ? `${contractId}:shop-collect-settlement:${input.requestId}`
          : `${contractId}:shop-collect-settlement:${amount.toFixed(2)}`,
        metadata: {
          tag: 'SCS',
          flow: 'shop-collect-settlement',
          contractId,
          amount: amount.toFixed(2),
          depositAccountCode,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          idempotencyKey: input.requestId
            ? `${contractId}:${input.requestId}`
            : `${contractId}:${amount.toFixed(2)}`,
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
