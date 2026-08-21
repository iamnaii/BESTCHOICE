import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
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
  /**
   * ประเภทลูกหนี้ 11-2107 ที่ใบนี้ล้าง (Phase 3 Task 6 — เส้นทางรับเงินสดคืน):
   * default `'SHOP_COLLECT'` — caller เดิม (JP4/shop-collect settle) ต้องได้
   * พฤติกรรม byte-identical. `'PAYOUT_RECALL'` ใช้โดย
   * `IntercoSettlementService.settleRecallCash` เท่านั้น — stamp ลง
   * `metadata.shopReceivableType` ให้ typed recall lens หักยอดต่อสัญญาได้ตรงประเภท.
   * Guards/idempotency/outstanding computation ไม่แตกต่างตามประเภท (untyped
   * per-contract Σ − POSTED deductions เหมือนเดิมทุกเส้นทาง).
   */
  typeStamp?: 'SHOP_COLLECT' | 'PAYOUT_RECALL';
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
 *   - outstanding 11-2107 (ΣDr − ΣCr over metadata.contractId, MINUS every
 *     deduction already taken by a POSTED interco batch — batch netting JEs
 *     deliberately carry no metadata.contractId, so "หักแล้ว" is read off
 *     InterCoSettlementItem, never GL metadata) must be > 0
 *   - rejected outright while the contract has a deduction row inside a
 *     PENDING_APPROVAL interco batch (final review C1 ด่าน (ii) — the same
 *     8,000 must not clear via cash here AND via the batch's netting leg;
 *     DRAFT batches don't block: approve's drift guard covers that ordering
 *     and the maker can still edit a DRAFT)
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
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['requestId'], equals: requestId } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
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
    input: ShopCollectSettlementInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; deduped: boolean }> {
    const { contractId, depositAccountCode } = input;
    const amount = new Decimal(input.amount.toString());
    const amountStr = amount.toFixed(2);
    const typeStamp = input.typeStamp ?? 'SHOP_COLLECT';

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
    //
    // contractId is part of the match — a requestId reused on a DIFFERENT
    // contract (client-side UUID collision, copy-pasted requestId across two
    // dialog opens, etc.) must NOT match that other contract's JE. Without
    // this, the second contract's settlement would be silently skipped,
    // leaving its 11-2107 balance uncleared with no error surfaced.
    //
    // NOTE: this is a check-then-act race — two requests with the SAME
    // requestId can both pass this check (neither JE exists yet) and both
    // proceed to createAndPost below. The loser hits a raw Prisma unique
    // violation (P2002 on journal_entries_idempotency_idx / ..._ref_unique)
    // there. Because both production callers wrap this whole call in a
    // Serializable `$transaction`, that P2002 has already aborted the tx —
    // there is no safe re-query left to run. The catch block around
    // createAndPost throws a clean ConflictException (409) instead of trying
    // to classify the race, so the loser gets an actionable error rather
    // than a raw 500. See that catch block for details.
    if (input.requestId) {
      const result = await this.findRequestIdDupe(client, contractId, input.requestId, amountStr);

      if (result.status === 'mismatch') {
        // ยอดเปลี่ยนไปจากตอนโพสต์ JE เดิม (หรืออ่าน metadata ไม่ได้) — ห้ามกลืนเงียบ
        // ต้องปฏิเสธ ไม่ใช่คืน success ของยอดเก่าให้ operator เข้าใจผิดว่ายอดใหม่บันทึกแล้ว
        this.logger.warn(
          `[SCS] requestId ${input.requestId} matched an existing JE but amount differs (booked=${result.bookedAmount}, incoming=${amountStr}) — rejecting`,
        );
        throw new ConflictException(
          `คำขอนี้ถูกบันทึกไปแล้วที่ยอด ${result.bookedAmount} ฿ — กรุณาปิดหน้าต่างรับโอนแล้วเปิดใหม่ หากต้องการบันทึกยอดใหม่`,
        );
      }

      if (result.status === 'match') {
        this.logger.log(
          `[SCS] duplicate requestId ${input.requestId} — JE ${result.entryNo} already posted, skipping`,
        );
        return { entryNo: result.entryNo, deduped: true };
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
    const grossOutstanding = totalDr.minus(totalCr);

    // ── กันหักซ้ำกับรอบจ่าย INTER-CO (final review C1 ด่าน (ii), 2026-08-20) ──
    // Batch-netting JEs deliberately stamp NO metadata.contractId (architecture
    // ruling "เลนส์ gross + item gate") — their Cr 11-2107 legs are invisible to
    // the per-contract sum above. "หักแล้วหรือยัง" therefore lives on
    // InterCoSettlementItem: subtract every POSTED batch's deduction for this
    // contract, and refuse to settle while an open (PENDING_APPROVAL) batch
    // still holds a deduction row for it — otherwise the same credit could be
    // cleared twice (cash here + the batch's netting leg). Legacy/JP4/JP5
    // shop-collect contracts have no deduction items at all → Σ = 0 → identical
    // behavior to before.
    const deductionItems = await client.interCoSettlementItem.findMany({
      where: {
        contractId,
        deletedAt: null,
        OR: [{ swapCreditAmount: { gt: 0 } }, { recallAmount: { gt: 0 } }],
        batch: { status: { in: ['PENDING_APPROVAL', 'POSTED'] }, deletedAt: null },
      },
      select: {
        swapCreditAmount: true,
        recallAmount: true,
        batch: { select: { status: true, batchNumber: true } },
      },
    });
    const openDeduction = deductionItems.find((i) => i.batch.status === 'PENDING_APPROVAL');
    if (openDeduction) {
      throw new BadRequestException(
        `สัญญานี้อยู่ในรอบจ่าย INTER-CO ${openDeduction.batch.batchNumber} ที่รอการอนุมัติและมียอดหักเครดิต — รอผลอนุมัติหรือถอนรอบก่อน`,
      );
    }
    const postedDeductions = deductionItems.reduce(
      (s, i) => s.plus(i.swapCreditAmount.toString()).plus(i.recallAmount.toString()),
      new Decimal(0),
    );
    const outstanding = grossOutstanding.minus(postedDeductions);

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
        return { entryNo: existing.entryNumber, deduped: true };
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
    try {
      const result = await this.journal.createAndPost(
        {
          description:
            typeStamp === 'PAYOUT_RECALL'
              ? `รับเงินคืนจากหน้าร้าน — สัญญา ${contractId.slice(0, 8)} (ล้าง 11-2107 เรียกคืน)`
              : `รับโอนจากหน้าร้าน — สัญญา ${contractId.slice(0, 8)} (ล้าง 11-2107)`,
          reference: input.requestId
            ? `${contractId}:shop-collect-settlement:${input.requestId}`
            : `${contractId}:shop-collect-settlement:${amountStr}`,
          metadata: {
            tag: 'SCS',
            flow: 'shop-collect-settlement',
            contractId,
            amount: amountStr,
            depositAccountCode,
            ...(input.requestId ? { requestId: input.requestId } : {}),
            shopReceivableType: typeStamp,
            idempotencyKey: input.requestId
              ? `${contractId}:${input.requestId}`
              : `${contractId}:${amountStr}`,
          },
          lines: [
            {
              accountCode: depositAccountCode,
              dr: amount,
              cr: zero,
              description:
                typeStamp === 'PAYOUT_RECALL'
                  ? `รับเงินคืนจากหน้าร้าน ${amountStr} ฿`
                  : `รับโอนจากหน้าร้าน ${amountStr} ฿`,
            },
            {
              accountCode: '11-2107',
              dr: zero,
              cr: amount,
              description:
                typeStamp === 'PAYOUT_RECALL'
                  ? 'ล้างลูกหนี้-หน้าร้าน (เรียกคืนยกเลิก)'
                  : 'ล้างลูกหนี้-หน้าร้าน (shop-collect)',
            },
          ],
        },
        outerTx,
      );

      return { entryNo: result.entryNumber, deduped: false };
    } catch (err) {
      // Race: two submissions with the SAME requestId both passed the
      // up-front dedupe check above (neither JE existed yet) and both
      // reached createAndPost. The winner posts; the loser hits a raw
      // Prisma unique violation (P2002 on journal_entries_idempotency_idx
      // or journal_entries_ref_unique) here.
      //
      // Both production callers (ContractPaymentService.shopCollectSettlement
      // and IntercoSettlementService.settleRecallCash — Phase 3 Task 6)
      // always wrap this call in a Serializable `$transaction` — by the time
      // createAndPost throws P2002, Postgres has already aborted that
      // transaction (25P02 "current transaction is aborted, commands ignored
      // until end of transaction block"). ANY further query on the SAME
      // client (including a re-query trying to classify the race as
      // match/mismatch) will itself throw — there is no DB access left to
      // recover with. Do NOT attempt one (precedent:
      // payroll-remittance.template.ts `postWithIdempotencyTranslation`) —
      // throw a clean, user-facing exception immediately instead. Throwing
      // needs no DB access, so it works inside the aborted tx and propagates
      // as a 409 instead of an unhandled 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.requestId) {
        this.logger.warn(
          `[SCS] race on requestId ${input.requestId} (contract ${contractId}) — P2002 inside an aborted tx, rejecting with 409 instead of re-querying`,
        );
        throw new ConflictException(
          'รายการนี้กำลังถูกบันทึกอยู่ (กดยืนยันซ้ำพร้อมกัน) — กรุณารอสักครู่ แล้วตรวจสอบรายการก่อนลองใหม่',
        );
      }

      // Empirically observed 2026-08-08 via a live 2-Postgres-connection race
      // test (shop-collect-settlement.integration.spec.ts): because both
      // production callers use SERIALIZABLE isolation, two concurrent
      // settlement calls on the SAME contract don't always collide
      // on the P2002 unique index first — Postgres SSI can detect the
      // read-write dependency (both transactions read the same 11-2107
      // journal_line predicate set, then one inserts a new row matching it)
      // and abort the loser with a 40001 serialization failure BEFORE it ever
      // reaches the unique-index insert. Prisma surfaces that as P2034
      // ("Transaction failed due to a write conflict or a deadlock. Please
      // retry your transaction."). This is a genuine transient DB conflict,
      // not a business-logic duplicate, so it applies regardless of whether
      // requestId was supplied — translate it into the same clean 409 so the
      // client can safely retry instead of seeing a raw Prisma error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        this.logger.warn(
          `[SCS] write conflict (P2034) on contract ${contractId} — rejecting with 409, client should retry`,
        );
        // SentryExceptionFilter only captures status >= 500 — a 409 like this
        // would otherwise be invisible. A spike of these could mean genuine
        // lock contention worth investigating, so surface it explicitly.
        Sentry.captureMessage('[SCS] P2034 write-conflict translated to 409', {
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
