import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface RefundWaiveInput {
  contractId: string;
  postedById?: string;
  /**
   * Client-generated UUID ต่อการกดยืนยันหนึ่งครั้ง — dedupe เฉพาะ retry ของคำขอเดิม.
   * ไม่มี legacy amount-based fallback ที่นี่เหมือน RefundPayoutTemplate เพราะ
   * template นี้ไม่รับ amount input เลย (เคลียร์ยอดคงเหลือทั้งหมดเสมอ) — คำขอที่ไม่มี
   * requestId (caller เก่า/สคริปต์ manual) จึงข้าม dedupe ไปตรง ๆ แล้วปล่อยให้
   * "outstanding.lte(0)" guard ด้านล่างเป็นเกราะกันยิงซ้ำแทน: ครั้งแรกล้างยอดจน
   * เหลือ 0 ครั้งที่สองจะชน guard นั้นเป็น 400 ไม่ใช่โพสต์ซ้ำเงียบ ๆ.
   */
  requestId?: string;
}

/**
 * Refund Waive — ล้างหนี้ 21-1107 ที่เหลือทั้งหมดเข้ารายได้จากการยึดสินค้า (41-1102)
 * เมื่อเจ้าของตัดสินใจ "ไม่คืนเงิน" ส่วนต่างที่ JP5 เคยตั้งไว้ (คำสั่งเจ้าของ 2026-08-08
 * เพิ่มเติม — หนี้สิ้นสภาพบังคับ = รายได้).
 *
 * JE:
 *   Dr 21-1107 เจ้าหนี้เงินคืนลูกค้า-ยึดเครื่อง [outstanding ทั้งหมด]
 *     Cr 41-1102 รายได้จากการยึดสินค้า          [outstanding ทั้งหมด]
 *
 * ต่างจาก RefundPayoutTemplate ตรงที่ไม่มี amount input — เคลียร์ "ยอดคงเหลือ
 * ทั้งหมด" เสมอ (รองรับกรณีจ่ายคืนบางส่วนไปแล้ว แล้วมาตัดสินใจไม่คืนส่วนที่เหลือ).
 * 21-1107 ยังเป็นบัญชีเจ้าหนี้ (credit-normal) เหมือนเดิม — outstanding = ΣCr − ΣDr
 * เลนส์เดียวกับ RefundPayoutTemplate เป๊ะ ๆ.
 *
 * Guards:
 *   - outstanding 21-1107 (ΣCr − ΣDr over metadata.contractId, POSTED, deletedAt
 *     null) ต้อง > 0 — ไม่งั้น throw ข้อความเดียวกับ RefundPayoutTemplate
 *
 * Idempotency: requestId-scoped dedupe เหมือน RefundPayoutTemplate (ดู
 * findRequestIdDupe) — แต่ไม่มี legacy fallback เพราะไม่มี amount ให้ match คู่กับ
 * flow เก่า. P2002 (requestId-gated race) และ P2034 (unconditional write-conflict,
 * Sentry-alarmed) ทั้งคู่ map เป็น 409 เหมือนกัน — pattern เดียวกับ RefundPayoutTemplate
 * (ดู doc comment ของไฟล์นั้นสำหรับ race-condition rationale ฉบับเต็ม).
 */
@Injectable()
export class RefundWaiveTemplate {
  private readonly logger = new Logger(RefundWaiveTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Look up an existing JE for this (contractId, requestId) pair. Unlike
   * RefundPayoutTemplate's findRequestIdDupe there is no amount to compare —
   * a requestId match on this (flow, contractId) pair is always the same
   * logical request (waive ALL of the outstanding balance), so any match is
   * a clean dedupe, never a mismatch to reject.
   */
  private async findRequestIdDupe(
    client: Prisma.TransactionClient | PrismaService,
    contractId: string,
    requestId: string,
  ): Promise<{ status: 'match'; entryNo: string; amount: string } | { status: 'none' }> {
    const dupe = await client.journalEntry.findFirst({
      where: {
        AND: [
          {
            metadata: { path: ['flow'], equals: 'refund-waive' },
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
    // metadata.amount always present in practice — numeric-shaped fallback for the money field
    return {
      status: 'match',
      entryNo: dupe.entryNumber,
      amount: typeof bookedAmount === 'string' ? bookedAmount : '0.00',
    };
  }

  async execute(
    input: RefundWaiveInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; waivedAmount: string; deduped: boolean }> {
    const { contractId } = input;
    const client = outerTx ?? this.prisma;

    // ── requestId idempotency (เช็คก่อน guard อื่นทั้งหมด) ─────────────────────
    // Checked BEFORE the outstanding computation — same rationale as
    // RefundPayoutTemplate: a retry that lands AFTER the 21-1107 balance has
    // already been fully cleared (by the first call) must still return the
    // original idempotent success instead of tripping the no-balance guard
    // below.
    if (input.requestId) {
      const result = await this.findRequestIdDupe(client, contractId, input.requestId);

      if (result.status === 'match') {
        this.logger.log(
          `[RefundWaive] duplicate requestId ${input.requestId} — JE ${result.entryNo} already posted, skipping`,
        );
        return { entryNo: result.entryNo, waivedAmount: result.amount, deduped: true };
      }
    }

    // ── Compute outstanding 21-1107 for this contract ─────────────────────────
    // 21-1107 is credit-normal (liability) — outstanding = ΣCr − ΣDr, identical
    // lens to RefundPayoutTemplate.
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

    const amountStr = outstanding.toFixed(2);
    const zero = new Decimal(0);

    // ── Post Dr 21-1107 / Cr 41-1102 ───────────────────────────────────────────
    try {
      const result = await this.journal.createAndPost(
        {
          description: `ล้างหนี้เงินคืนลูกค้า — ตัดสินใจไม่คืน สัญญา ${contractId.slice(0, 8)} (ล้าง 21-1107)`,
          reference: input.requestId
            ? `${contractId}:refund-waive:${input.requestId}`
            : `${contractId}:refund-waive:${amountStr}`,
          metadata: {
            tag: 'REFUND_WAIVED',
            flow: 'refund-waive',
            contractId,
            amount: amountStr,
            ...(input.requestId ? { requestId: input.requestId } : {}),
            idempotencyKey: input.requestId
              ? `${contractId}:${input.requestId}`
              : `${contractId}:${amountStr}`,
          },
          lines: [
            {
              accountCode: '21-1107',
              dr: outstanding,
              cr: zero,
              description: `ล้างหนี้เงินคืน — ตัดสินใจไม่คืน (ไม่คืนเงินส่วนต่าง) ${amountStr} ฿`,
            },
            {
              accountCode: '41-1102',
              dr: zero,
              cr: outstanding,
              description: `รายได้จากการยึด — เงินคืนที่ไม่ต้องจ่ายแล้ว ${amountStr} ฿`,
            },
          ],
        },
        outerTx,
      );

      return { entryNo: result.entryNumber, waivedAmount: amountStr, deduped: false };
    } catch (err) {
      // Race handling — identical rationale to RefundPayoutTemplate: by the
      // time createAndPost throws P2002/P2034 inside a Serializable caller
      // transaction, that transaction is already aborted, so no further
      // query on the same client can succeed. Throw a clean 409 immediately
      // instead of attempting to re-query and classify the race.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        input.requestId
      ) {
        this.logger.warn(
          `[RefundWaive] race on requestId ${input.requestId} (contract ${contractId}) — P2002 inside an aborted tx, rejecting with 409 instead of re-querying`,
        );
        throw new ConflictException(
          'รายการนี้กำลังถูกบันทึกอยู่ (กดยืนยันซ้ำพร้อมกัน) — กรุณารอสักครู่ แล้วตรวจสอบรายการก่อนลองใหม่',
        );
      }

      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        this.logger.warn(
          `[RefundWaive] write conflict (P2034) on contract ${contractId} — rejecting with 409, client should retry`,
        );
        Sentry.captureMessage('[RefundWaive] P2034 write-conflict translated to 409', {
          level: 'warning',
          extra: { contractId, requestId: input.requestId ?? null, amount: amountStr },
        });
        throw new ConflictException(
          'มีการบันทึกรายการนี้พร้อมกันจากอีกจุดหนึ่ง (write conflict) — กรุณาลองใหม่อีกครั้ง',
        );
      }

      throw err;
    }
  }
}
