import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../account-role.service';
import { computeInstallmentBreakdown } from '../compute-installment-breakdown';
import { splitReceipt, SplitReceiptResult } from '../split-receipt';
import { buildReceiptLines } from '../build-receipt-lines';
import { reconstructPriorCleared } from '../reconstruct-prior';

const TOLERANCE = new Decimal('1.00');

export interface PaymentReceiptPrimitiveInput {
  installmentScheduleId: string;
  /** Cash (or customer-credit) received THIS receipt for THIS installment. */
  delta: Decimal;
  /** Cash code (11-11xx / 11-12xx) OR '21-5101' for the credit-balance path. */
  debitAccountCode: string;
  /** Total (GROSS) late fee owed on this installment (default 0). */
  lateFee?: Decimal;
  /**
   * Waived portion of the late fee (D1 gross-waiver, default 0). Books to Dr 52-1105
   * and grosses up Cr 42-1103; splitReceipt is fed the NET (gross − waived) so cash
   * only needs to cover the un-waived portion. Must be ≤ lateFee.
   */
  lateFeeWaived?: Decimal;
  /** Existing 21-1103 advance consumed to supplement delta (default 0). */
  advanceConsume?: Decimal;
  /** Surplus parked as new 21-1103 advance (default 0). */
  advanceCredit?: Decimal;
  /** True when this receipt closes the installment (enables ≤1฿ underpay close). */
  isFinalReceipt?: boolean;
  /** Required when the final receipt underpays by ≤1฿ (52-1104 route). */
  toleranceApproverId?: string;
  /**
   * Set by callers when a ≤1฿ underpay-close is a SYSTEM rounding residual (the
   * payer covered the full billed amountDue but amountDue < installmentTotal by a
   * rounding artifact), NOT a customer underpayment. When true, the ≤1฿ underpay
   * routes to 52-1104 WITHOUT a toleranceApproverId. Genuine customer underpayments
   * must leave this false and supply an approver.
   */
  autoApproveSystemRounding?: boolean;
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
  /**
   * Optional JE post date (D4 backdating). Defaults to now inside createAndPost.
   * Forwarded by recordPayment as the caller-supplied paidDate so a backdated
   * receipt's ledger entry is dated to the payment date, not "now".
   */
  postedAt?: Date;
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
   * D1.1.6.3 (ported from PaymentReceipt2BTemplate, PR-843/I2 Phase 3 3a) —
   * read `adj_auto_route` flag (default TRUE).
   * Inlined direct SystemConfig read (PrismaService) to avoid pulling
   * SettingsModule into the journal module DI graph. Defaults to TRUE so
   * first-boot behaviour is unchanged.
   */
  private async readAdjAutoRouteFlag(
    tx: Prisma.TransactionClient | PrismaService,
  ): Promise<boolean> {
    try {
      const row = await tx.systemConfig.findFirst({
        where: { key: 'adj_auto_route', deletedAt: null },
        select: { value: true },
      });
      if (!row?.value) return true;
      const v = row.value.trim().toLowerCase();
      if (v === 'false' || v === '0') return false;
      if (v === 'true' || v === '1') return true;
      return true;
    } catch {
      return true;
    }
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

    // Shared with the wizard's PARTIAL preview (reconstruct-prior.ts) so the
    // preview's allocation can't drift from what this template posts.
    const { priorPrincipalCleared, priorLateFeeBooked } = await reconstructPriorCleared(
      readClient,
      inst.id,
      installmentTotal,
    );

    const delta = input.delta;
    const lateFeeGross = input.lateFee ?? new Decimal(0);
    const lateFeeWaived = input.lateFeeWaived ?? new Decimal(0);
    // Gross-waiver (D1): splitReceipt is fed the NET late fee (cash must cover only
    // the un-waived portion); the waived portion books to Dr 52-1105 + grosses up
    // Cr 42-1103 inside buildReceiptLines.
    const netLateFee = lateFeeGross.minus(lateFeeWaived);
    if (netLateFee.lt(0)) {
      throw new BadRequestException(
        `lateFeeWaived ${lateFeeWaived.toFixed(2)} exceeds late fee ${lateFeeGross.toFixed(2)}`,
      );
    }
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
      lateFee: netLateFee,
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
    // The ≤1฿ underpay-close (Dr 52-1104) still posts unconditionally; this guard
    // only waives the APPROVER REQUIREMENT. When `autoApproveSystemRounding` is set
    // the caller has certified that the payer covered the full billed amountDue and
    // the residual is a pure amountDue↔installmentTotal rounding artifact (Phase 5b),
    // so no toleranceApproverId is needed. A GENUINE customer underpayment leaves the
    // flag false and STILL requires an approver.
    if (
      split.underpayRounding.gt(0) &&
      !input.toleranceApproverId &&
      !input.autoApproveSystemRounding
    ) {
      throw new BadRequestException('Underpay tolerance requires approver (toleranceApproverId)');
    }

    // D1.1.6.3 (ported from 2B, PR-843/I2 Phase 3 3a) — when `adj_auto_route`
    // is off, refuse to auto-route a non-zero rounding remainder to the
    // adj_overpay (53-1503) / adj_underpay (52-1104) accounts. The owner must
    // clear the diff manually (e.g. via a manual JV) before the receipt posts.
    // Mirrors the 2B guard exactly so the most-used money path keeps the same
    // behaviour after the primitive swap.
    if (split.overpayRounding.gt(0) || split.underpayRounding.gt(0)) {
      if (!(await this.readAdjAutoRouteFlag(readClient))) {
        throw new BadRequestException('Auto-routing disabled — manual adjustment required');
      }
    }

    const overpayCode = this.roles?.tryCode('adj_overpay') ?? '53-1503';
    const underpayCode = this.roles?.tryCode('adj_underpay') ?? '52-1104';

    // Shared pure builder (also used by the wizard preview so the two can't drift).
    const lines = buildReceiptLines({
      split,
      debitAccountCode: input.debitAccountCode,
      delta,
      advanceConsume,
      advanceCredit,
      lateFeeWaived,
      overpayCode,
      underpayCode,
    });

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
        postedAt: input.postedAt,
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
          lateFeeWaived: lateFeeWaived.toString(),
        },
        lines,
      },
      outerTx,
    );

    return { entryNo: result.entryNumber, split };
  }
}
