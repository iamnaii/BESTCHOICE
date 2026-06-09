import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../account-role.service';
import { computeInstallmentBreakdown } from '../compute-installment-breakdown';
import { splitReceipt, SplitReceiptResult } from '../split-receipt';

const TOLERANCE = new Decimal('1.00');

export interface PaymentReceiptPrimitiveInput {
  installmentScheduleId: string;
  /** Cash (or customer-credit) received THIS receipt for THIS installment. */
  delta: Decimal;
  /** Cash code (11-11xx / 11-12xx) OR '21-5101' for the credit-balance path. */
  debitAccountCode: string;
  /** Total late fee owed on this installment (default 0). */
  lateFee?: Decimal;
  /** Existing 21-1103 advance consumed to supplement delta (default 0). */
  advanceConsume?: Decimal;
  /** Surplus parked as new 21-1103 advance (default 0). */
  advanceCredit?: Decimal;
  /** True when this receipt closes the installment (enables ≤1฿ underpay close). */
  isFinalReceipt?: boolean;
  /** Required when the final receipt underpays by ≤1฿ (52-1104 route). */
  toleranceApproverId?: string;
  /** Caller-owned Payment row id → stamped to metadata.paymentId (the canonical payment→JE key). */
  paymentId?: string;
  /**
   * Per-receipt idempotency key. When provided it is stamped to
   * metadata.idempotencyKey for traceability/queryability.
   *
   * PR-843/I2 Phase 3 PR 3.1: stamp-only for now (no unique constraint enforced).
   * Per-receipt-idempotency enforcement (a DB partial-unique index on
   * metadata.idempotencyKey so a retried partial/completion never double-posts)
   * is the 3a/3b follow-up where the payment paths pass real per-receipt keys.
   */
  idempotencyKey?: string;
}

/**
 * PaymentReceiptTemplate — the single "post a receipt for delta X" primitive
 * (PR-843 / I2). Generalises the applyCreditBalance custom-delta JE + the
 * 2B-split sumPriorPartials reconstruction. Every receipt clears only what it
 * covers, so Σ(Cr 11-2103) per installment == installmentTotal and
 * Σ(Cr 42-1103) == lateFee for ANY receipt sequence / ANY path.
 *
 * JE:
 *   Dr debitAccountCode      delta            (skip if 0)
 *   Dr 21-1103               advanceConsume   (if > 0)
 *   Dr 52-1104               underpayRounding (final ≤1฿ close; needs approver)
 *     Cr 11-2103             principalCleared
 *     Cr 42-1103             lateFeePortion   (if > 0)
 *     Cr 53-1503             overpayRounding  (if > 0)
 *     Cr 21-1103             advanceCredit    (if > 0)
 */
@Injectable()
export class PaymentReceiptTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    @Optional() private readonly roles?: AccountRoleService,
  ) {}

  /**
   * Reconstruct prior cleared amounts for this installment from its own prior JE lines.
   *
   * Phase 2: matched only `tag:'receipt'` entries.
   * Phase 3 (PR-843/I2 Option A — widen reconstruction): also matches `tag:'2B'` entries
   * so that a legacy partial posted by the OLD non-split PaymentReceipt2BTemplate is not
   * invisible to the primitive.  A legacy 2B JE carries:
   *   metadata: { tag:'2B', contractId, installmentScheduleId, paymentId }  (NO partial/final flag)
   *
   * Discriminator (guards against over-inclusion):
   *   - tag:'receipt' → always include (primitive's own JEs).
   *   - tag:'2B'     → include ONLY when Cr 11-2103 on that entry is STRICTLY LESS THAN
   *                    installmentTotal.  A full-clear 2B credits exactly installmentTotal;
   *                    including it would set priorPrincipalCleared = installmentTotal and
   *                    silently make principalRemaining = 0, rejecting any subsequent receipt.
   *                    Using strict-less-than (no float equality) is safe: installmentTotal
   *                    is a Decimal from computeInstallmentBreakdown, and the historical JE
   *                    credit is also a Decimal stored in Postgres — comparison is exact.
   *
   * Historical JEs are never mutated (Option A = read-side only).
   */
  private async reconstructPrior(
    readClient: Prisma.TransactionClient | PrismaService,
    installmentScheduleId: string,
    installmentTotal: Decimal,
  ): Promise<{ priorPrincipalCleared: Decimal; priorLateFeeBooked: Decimal }> {
    const entries = await readClient.journalEntry.findMany({
      where: {
        AND: [
          {
            OR: [
              { metadata: { path: ['tag'], equals: 'receipt' } } as any,
              { metadata: { path: ['tag'], equals: '2B' } } as any,
            ],
          },
          {
            metadata: { path: ['installmentScheduleId'], equals: installmentScheduleId },
          } as any,
        ],
      },
      include: { lines: true },
    });
    let priorPrincipalCleared = new Decimal(0);
    let priorLateFeeBooked = new Decimal(0);
    for (const e of entries) {
      const meta = e.metadata as any;
      const tag: string = meta?.tag ?? '';
      if (tag === '2B') {
        // Compute this entry's Cr 11-2103 to decide inclusion.
        const entryCr11 = e.lines
          .filter((l) => l.accountCode === '11-2103')
          .reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
        // Only partial-clear 2B JEs are included; full-clear JEs (cr == installmentTotal) are excluded.
        if (!entryCr11.lt(installmentTotal)) continue;
      }
      for (const l of e.lines) {
        const cr = new Decimal(l.credit.toString());
        if (l.accountCode === '11-2103') priorPrincipalCleared = priorPrincipalCleared.plus(cr);
        else if (l.accountCode === '42-1103') priorLateFeeBooked = priorLateFeeBooked.plus(cr);
      }
    }
    return { priorPrincipalCleared, priorLateFeeBooked };
  }

  async execute(
    input: PaymentReceiptPrimitiveInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; split: SplitReceiptResult }> {
    const readClient: Prisma.TransactionClient | PrismaService = outerTx ?? this.prisma;

    const inst = await readClient.installmentSchedule.findUniqueOrThrow({
      where: { id: input.installmentScheduleId },
      include: { contract: true },
    });
    const c = inst.contract;

    const { installmentTotal } = computeInstallmentBreakdown({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
      interestTotal: c.interestTotal.toString(),
      vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
      totalMonths: c.totalMonths,
    });

    const { priorPrincipalCleared, priorLateFeeBooked } = await this.reconstructPrior(
      readClient,
      inst.id,
      installmentTotal,
    );

    const delta = input.delta;
    const lateFee = input.lateFee ?? new Decimal(0);
    const advanceConsume = input.advanceConsume ?? new Decimal(0);
    const advanceCredit = input.advanceCredit ?? new Decimal(0);

    // Precondition for splitReceipt (review I-1): funds to allocate must be ≥0.
    // A mis-computed advanceCredit must never silently produce a negative JE line.
    if (advanceCredit.gt(delta.plus(advanceConsume))) {
      throw new BadRequestException(
        `advanceCredit ${advanceCredit.toFixed(2)} exceeds available funds (delta + advanceConsume ${delta
          .plus(advanceConsume)
          .toFixed(2)})`,
      );
    }

    const split = splitReceipt({
      delta,
      installmentTotal,
      lateFee,
      priorPrincipalCleared,
      priorLateFeeBooked,
      advanceConsume,
      advanceCredit,
      isFinalReceipt: input.isFinalReceipt ?? false,
    });

    // Tolerance enforcement (template-side; the pure fn stays Nest-free).
    if (split.overpayRounding.gt(TOLERANCE)) {
      throw new BadRequestException(
        `Payment difference ${split.overpayRounding.toFixed(2)} exceeds tolerance 1.00`,
      );
    }
    if ((input.isFinalReceipt ?? false) && split.principalRemainingAfter.gt(TOLERANCE)) {
      throw new BadRequestException(
        `Cannot close installment — residual ${split.principalRemainingAfter.toFixed(2)} exceeds tolerance 1.00`,
      );
    }
    if (split.underpayRounding.gt(0) && !input.toleranceApproverId) {
      throw new BadRequestException('Underpay tolerance requires approver (toleranceApproverId)');
    }

    const zero = new Decimal(0);
    const overpayCode = this.roles?.tryCode('adj_overpay') ?? '53-1503';
    const underpayCode = this.roles?.tryCode('adj_underpay') ?? '52-1104';

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [];
    if (delta.gt(0)) {
      lines.push({ accountCode: input.debitAccountCode, dr: delta, cr: zero, description: 'รับเงิน' });
    }
    if (advanceConsume.gt(0)) {
      lines.push({ accountCode: '21-1103', dr: advanceConsume, cr: zero, description: 'หักเงินรับล่วงหน้า' });
    }
    if (split.underpayRounding.gt(0)) {
      lines.push({
        accountCode: underpayCode,
        dr: split.underpayRounding,
        cr: zero,
        description: 'ส่วนลดเศษสตางค์ (ปิดยอด)',
      });
    }
    if (split.principalCleared.gt(0)) {
      lines.push({ accountCode: '11-2103', dr: zero, cr: split.principalCleared, description: 'ล้างลูกหนี้ค้างชำระ' });
    }
    if (split.lateFeePortion.gt(0)) {
      lines.push({ accountCode: '42-1103', dr: zero, cr: split.lateFeePortion, description: 'ค่าปรับชำระล่าช้า' });
    }
    if (split.overpayRounding.gt(0)) {
      lines.push({ accountCode: overpayCode, dr: zero, cr: split.overpayRounding, description: 'กำไรปัดเศษ' });
    }
    if (advanceCredit.gt(0)) {
      lines.push({ accountCode: '21-1103', dr: zero, cr: advanceCredit, description: 'เงินรับล่วงหน้า' });
    }

    // Review I-1: refuse to post a meaningless zero-line JE. Reachable when a
    // caller issues a receipt against an already fully-cleared installment
    // (delta/advance all 0 and principalRemaining 0 → every line skipped).
    if (lines.length === 0) {
      throw new BadRequestException(
        `ไม่มีรายการบัญชีที่ต้องบันทึก — งวดนี้ถูกชำระครบแล้ว (installmentScheduleId: ${input.installmentScheduleId})`,
      );
    }

    // companyId intentionally omitted: every line here is a FINANCE account
    // (11-2103 / 42-1103 / 53-1503 / 52-1104 / 21-1103 / deposit), so createAndPost's
    // FINANCE default is correct — matches PaymentReceipt2B(Split)Template. (Review I-2)
    const result = await this.journal.createAndPost(
      {
        description: `รับชำระงวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
        // PR-843/I2 Phase 3 PR 3.1 — the JE `reference` is ALWAYS a fresh UUID, never
        // `input.paymentId`. The epic posts MULTIPLE receipt JEs per Payment (a partial
        // then a completion on one installment) sharing the SAME paymentId; keying the
        // JE reference off paymentId would collide on the partial-unique index
        // `journal_entries_ref_unique (reference_type, reference_id)`. The canonical
        // payment→JE link is `metadata.paymentId` (below) — that is what voidReceipt /
        // markReversed query to reverse EVERY receipt JE of a payment.
        reference: randomUUID(),
        metadata: {
          tag: 'receipt',
          // Traceability/queryability for the per-receipt flow (PR 3.1).
          flow: 'payment-receipt',
          contractId: c.id,
          installmentScheduleId: inst.id,
          // Canonical payment→JE key. N receipt JEs of one payment all share this.
          paymentId: input.paymentId ?? null,
          // Stamped-only per-receipt idempotency key (no unique constraint in PR 3.1 —
          // enforcement is the 3a/3b follow-up; see PaymentReceiptPrimitiveInput JSDoc).
          idempotencyKey: input.idempotencyKey ?? null,
          deltaApplied: delta.toString(),
          principalCleared: split.principalCleared.toString(),
          lateFeePortion: split.lateFeePortion.toString(),
        },
        lines,
      },
      outerTx,
    );

    return { entryNo: result.entryNumber, split };
  }
}
