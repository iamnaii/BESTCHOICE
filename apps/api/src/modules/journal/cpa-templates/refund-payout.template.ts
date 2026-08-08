import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

export interface RefundPayoutInput {
  contractId: string;
  /** Cash/bank account that pays out the refund to the customer (must be in CASH_ACCOUNT_CODES). */
  depositAccountCode: string;
  /** Amount to pay out — must be ≤ outstanding 21-1107 balance + 0.01 tolerance. */
  amount: number | Decimal;
  postedById?: string;
  /**
   * Client-generated UUID ต่อการกดยืนยันหนึ่งครั้ง — dedupe เฉพาะ retry ของคำขอเดิม
   * โดยไม่กลืนการจ่ายซ้ำยอดเท่ากันที่ตั้งใจ. ไม่ส่ง = fallback dedupe แบบเก่า
   * (contractId+amount) เพื่อ backward compat กับ caller เดิม.
   */
  requestId?: string;
}

/**
 * Refund Payout — clears the Cr 21-1107 liability created by JP5's
 * `customerRefund` line (คำสั่งเจ้าของ 2026-08-08 ข้อ 2) when FINANCE actually
 * pays the customer back their share of the excess (ราคากลาง > ยอดปิดสัญญา).
 *
 * JE:
 *   Dr 21-1107 เจ้าหนี้เงินคืนลูกค้า-ยึดเครื่อง [amount]
 *     Cr depositAccountCode                     [amount]   (cash/bank paid out)
 *
 * This is a LIABILITY CLEARANCE (Dr liability / Cr asset) — the mirror image
 * of ShopCollectSettlementTemplate (which clears a Dr 11-2107 RECEIVABLE with
 * Dr cash / Cr 11-2107). 21-1107 is a credit-normal liability, so "outstanding"
 * here is ΣCr − ΣDr (not ΣDr − ΣCr as in the shop-collect template).
 *
 * Guards:
 *   - depositAccountCode must be in CASH_ACCOUNT_CODES
 *   - outstanding 21-1107 (ΣCr − ΣDr over metadata.contractId) must be > 0
 *   - amount must be ≤ outstanding + 0.01 (over-payout rejected)
 *
 * Idempotency: same requestId/legacy-fallback pattern as
 * ShopCollectSettlementTemplate — see that template's doc comment for the
 * full race-condition rationale (P2002 unique-index race + P2034 SSI
 * write-conflict, both translated to a clean 409 instead of a raw 500). Copied
 * pattern from `git show fix/repossessions-followups-2026-08:apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts`
 * (Task 2 brief, 2026-08-08) — this branch forked from `main` before that
 * branch's P2034 handling merged, so it is reproduced here directly.
 */
@Injectable()
export class RefundPayoutTemplate {
  private readonly logger = new Logger(RefundPayoutTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Look up an existing JE for this (contractId, requestId) pair and classify
   * it against the incoming amount. Used by the up-front idempotency check in
   * `execute` only — the post-P2002-race path does NOT call this (see the
   * catch block around `createAndPost`: the caller's tx is already aborted by
   * the time P2002 surfaces, so no further query on that connection can
   * succeed).
   */
  private async findRequestIdDupe(
    client: Prisma.TransactionClient | PrismaService,
    contractId: string,
    requestId: string,
    amountStr: string,
  ): Promise<
    | { status: 'match'; entryNo: string }
    | { status: 'mismatch'; bookedAmount: string }
    | { status: 'none' }
  > {
    const dupe = await client.journalEntry.findFirst({
      where: {
        AND: [
          {
            metadata: { path: ['flow'], equals: 'refund-payout' },
          } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['requestId'], equals: requestId } } as Prisma.JournalEntryWhereInput,
          {
            metadata: { path: ['contractId'], equals: contractId },
          } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });
    if (!dupe) return { status: 'none' };

    const dupeMetadata = dupe.metadata as Record<string, unknown> | null;
    const bookedAmount = dupeMetadata?.['amount'];
    const isSameAmount = typeof bookedAmount === 'string' && bookedAmount === amountStr;

    if (isSameAmount) return { status: 'match', entryNo: dupe.entryNumber };
    return {
      status: 'mismatch',
      bookedAmount: typeof bookedAmount === 'string' ? bookedAmount : 'ไม่ทราบยอด',
    };
  }

  async execute(
    input: RefundPayoutInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; deduped: boolean }> {
    const { contractId, depositAccountCode } = input;
    const amount = new Decimal(input.amount.toString());
    const amountStr = amount.toFixed(2);

    // ── Validate deposit account ──────────────────────────────────────────────
    if (!(CASH_ACCOUNT_CODES as readonly string[]).includes(depositAccountCode)) {
      throw new BadRequestException(
        `บัญชีจ่ายเงิน "${depositAccountCode}" ไม่ถูกต้อง — ต้องเป็นหนึ่งใน ${CASH_ACCOUNT_CODES.join(', ')}`,
      );
    }

    const client = outerTx ?? this.prisma;

    // ── requestId idempotency (เช็คก่อน guard อื่นทั้งหมด) ─────────────────────
    // Checked BEFORE the outstanding computation — same rationale as
    // ShopCollectSettlementTemplate: a retry that lands AFTER the 21-1107
    // balance has already been fully cleared (by the first call) must still
    // return the original idempotent success instead of tripping the
    // no-balance guard below. contractId is part of the match — a requestId
    // reused on a DIFFERENT contract must NOT match that other contract's JE.
    if (input.requestId) {
      const result = await this.findRequestIdDupe(client, contractId, input.requestId, amountStr);

      if (result.status === 'mismatch') {
        this.logger.warn(
          `[RefundPayout] requestId ${input.requestId} matched an existing JE but amount differs (booked=${result.bookedAmount}, incoming=${amountStr}) — rejecting`,
        );
        throw new ConflictException(
          `คำขอนี้ถูกบันทึกไปแล้วที่ยอด ${result.bookedAmount} ฿ — กรุณาปิดหน้าต่างจ่ายเงินคืนแล้วเปิดใหม่ หากต้องการบันทึกยอดใหม่`,
        );
      }

      if (result.status === 'match') {
        this.logger.log(
          `[RefundPayout] duplicate requestId ${input.requestId} — JE ${result.entryNo} already posted, skipping`,
        );
        return { entryNo: result.entryNo, deduped: true };
      }
    }

    // ── Compute outstanding 21-1107 for this contract ─────────────────────────
    // 21-1107 is credit-normal (liability) — outstanding = ΣCr − ΣDr, the
    // mirror of ShopCollectSettlementTemplate's ΣDr − ΣCr on the debit-normal
    // 11-2107 receivable.
    const lines = await client.journalLine.findMany({
      where: {
        accountCode: '21-1107',
        journalEntry: {
          AND: [
            {
              metadata: { path: ['contractId'], equals: contractId },
            } as Prisma.JournalEntryWhereInput,
            { status: 'POSTED' },
            { deletedAt: null },
          ],
        },
      },
      select: { debit: true, credit: true },
    });

    const totalDr = lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const totalCr = lines.reduce(
      (s, l) => s.plus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    const outstanding = totalCr.minus(totalDr);

    if (outstanding.lte(0)) {
      throw new BadRequestException(
        `ไม่มียอดเจ้าหนี้เงินคืนลูกค้าค้างจ่ายสำหรับสัญญานี้ (ยอดคงเหลือ = ${outstanding.toFixed(2)})`,
      );
    }

    // ── Over-pay guard ─────────────────────────────────────────────────────────
    if (amount.gt(outstanding.plus('0.01'))) {
      throw new BadRequestException(
        `ยอดจ่ายคืน ${amount.toFixed(2)} ฿ เกินกว่ายอดค้าง ${outstanding.toFixed(2)} ฿ ไม่อนุญาต`,
      );
    }

    // ── Legacy idempotency (เฉพาะ caller เก่าที่ไม่ส่ง requestId) ─────────────
    if (!input.requestId) {
      const existing = await client.journalEntry.findFirst({
        where: {
          AND: [
            {
              metadata: { path: ['flow'], equals: 'refund-payout' },
            } as Prisma.JournalEntryWhereInput,
            {
              metadata: { path: ['contractId'], equals: contractId },
            } as Prisma.JournalEntryWhereInput,
            {
              metadata: { path: ['amount'], equals: amount.toFixed(2) },
            } as Prisma.JournalEntryWhereInput,
          ],
          deletedAt: null,
        },
      });

      if (existing) {
        this.logger.log(
          `[RefundPayout] idempotency — JE ${existing.entryNumber} already exists for contract ${contractId} amount=${amount.toFixed(2)}, skipping`,
        );
        return { entryNo: existing.entryNumber, deduped: true };
      }
    }

    const zero = new Decimal(0);

    // ── Post Dr 21-1107 / Cr depositAccountCode ───────────────────────────────
    try {
      const result = await this.journal.createAndPost(
        {
          description: `จ่ายเงินคืนส่วนต่างลูกค้า — สัญญา ${contractId.slice(0, 8)} (ล้าง 21-1107)`,
          reference: input.requestId
            ? `${contractId}:refund-payout:${input.requestId}`
            : `${contractId}:refund-payout:${amountStr}`,
          metadata: {
            tag: 'REFUND_PAYOUT',
            flow: 'refund-payout',
            contractId,
            amount: amountStr,
            depositAccountCode,
            ...(input.requestId ? { requestId: input.requestId } : {}),
            idempotencyKey: input.requestId
              ? `${contractId}:${input.requestId}`
              : `${contractId}:${amountStr}`,
          },
          lines: [
            {
              accountCode: '21-1107',
              dr: amount,
              cr: zero,
              description: `ล้างเจ้าหนี้เงินคืนลูกค้า-ยึดเครื่อง ${amountStr} ฿`,
            },
            {
              accountCode: depositAccountCode,
              dr: zero,
              cr: amount,
              description: `จ่ายเงินคืนลูกค้า ${amountStr} ฿`,
            },
          ],
        },
        outerTx,
      );

      return { entryNo: result.entryNumber, deduped: false };
    } catch (err) {
      // Race handling — identical rationale to ShopCollectSettlementTemplate:
      // by the time createAndPost throws P2002/P2034 inside a Serializable
      // caller transaction, that transaction is already aborted, so no
      // further query on the same client can succeed. Throw a clean 409
      // immediately instead of attempting to re-query and classify the race.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        input.requestId
      ) {
        this.logger.warn(
          `[RefundPayout] race on requestId ${input.requestId} (contract ${contractId}) — P2002 inside an aborted tx, rejecting with 409 instead of re-querying`,
        );
        throw new ConflictException(
          'รายการนี้กำลังถูกบันทึกอยู่ (กดยืนยันซ้ำพร้อมกัน) — กรุณารอสักครู่ แล้วตรวจสอบรายการก่อนลองใหม่',
        );
      }

      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        this.logger.warn(
          `[RefundPayout] write conflict (P2034) on contract ${contractId} — rejecting with 409, client should retry`,
        );
        Sentry.captureMessage('[RefundPayout] P2034 write-conflict translated to 409', {
          level: 'warning',
          extra: { contractId, requestId: input.requestId ?? null, amount: amount.toFixed(2) },
        });
        throw new ConflictException(
          'มีการบันทึกรายการนี้พร้อมกันจากอีกจุดหนึ่ง (write conflict) — กรุณาลองใหม่อีกครั้ง',
        );
      }

      throw err;
    }
  }
}
