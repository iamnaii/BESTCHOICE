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
  /** Caller-owned Payment row id → JE reference. Omitted → generated UUID. */
  paymentId?: string;
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
   * Reconstruct prior cleared amounts for this installment from its own prior
   * `tag:'receipt'` JE lines: Σ Cr 11-2103 (principal) and Σ Cr 42-1103 (late fee).
   */
  private async reconstructPrior(
    readClient: Prisma.TransactionClient | PrismaService,
    installmentScheduleId: string,
  ): Promise<{ priorPrincipalCleared: Decimal; priorLateFeeBooked: Decimal }> {
    const entries = await readClient.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
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

    const result = await this.journal.createAndPost(
      {
        description: `รับชำระงวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
        reference: input.paymentId ?? randomUUID(),
        metadata: {
          tag: 'receipt',
          contractId: c.id,
          installmentScheduleId: inst.id,
          paymentId: input.paymentId ?? null,
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
