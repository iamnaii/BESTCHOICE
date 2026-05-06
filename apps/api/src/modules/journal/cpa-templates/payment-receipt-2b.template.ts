import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Vat60dayReversalTemplate } from './vat-60day-reversal.template';

const TOLERANCE = new Decimal('1.00');

export interface PaymentReceiptInput {
  installmentScheduleId: string;
  amountReceived: Decimal;
  depositAccountCode: string;
  toleranceApproverId?: string;
  /**
   * Phase A.4b caller wiring: when the caller has already created the Payment row
   * (e.g. payments.service, paysolutions.service), pass the existing paymentId here.
   * The template will use it as the JE referenceId and skip creating a new Payment row.
   * When omitted, the template creates its own Payment row (standalone use).
   */
  existingPaymentId?: string;
  /**
   * Overpay > 1฿ → post Cr 21-1103 (park excess as advance).
   * Caller pre-computes: advanceCredit = amountReceived - installmentTotal.
   * When provided, the overpay amount is removed from the tolerance check.
   */
  advanceCredit?: Decimal;
  /**
   * Consume existing 21-1103 advance balance → post Dr 21-1103.
   * Caller pre-computes: advanceConsume = min(contract.advanceBalance, gap).
   * When provided, this amount supplements amountReceived to cover installmentTotal.
   */
  advanceConsume?: Decimal;
  /**
   * Customer pays less than the full installment intentionally.
   * Skip tolerance check; emit only Dr cash X / Cr 11-2103 X (partial clear).
   * Per CSV case-3-split-payment.csv pattern.
   */
  partialClear?: boolean;
}

/**
 * Template 2B — Payment Receipt (Cases 1+2 with tolerance ≤1฿).
 *
 * Spec §6.3 — records the cash received against the accrued receivable:
 *
 * Case 1 — Overpay (diff > 0, diff ≤ 1฿):
 *   Dr depositAccountCode   amountReceived
 *     Cr 11-2103 ลูกหนี้ค้างชำระ  installmentTotal
 *     Cr 53-1503 กำไรปัดเศษ        diff
 *
 * Case 2 — Underpay (diff < 0, abs(diff) ≤ 1฿, requires approverId):
 *   Dr depositAccountCode   amountReceived
 *   Dr 52-1104 ส่วนลดเศษสตางค์  abs(diff)
 *     Cr 11-2103 ลูกหนี้ค้างชำระ  installmentTotal
 *
 * Reject: abs(diff) > 1.00 → BadRequestException 'exceeds tolerance'
 * Reject: underpay without toleranceApproverId → BadRequestException 'approver'
 *
 * Reference strategy: creates a Payment row first, uses paymentId as referenceId
 * to avoid colliding with 2A which uses installmentScheduleId.
 */
@Injectable()
export class PaymentReceipt2BTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    @Optional() private readonly vat60Reversal?: Vat60dayReversalTemplate,
  ) {}

  async execute(input: PaymentReceiptInput): Promise<{ entryNo: string }> {
    // Pre-fetch outside transaction for validation (read-only)
    const inst = await this.prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: input.installmentScheduleId },
      include: { contract: true },
    });

    const c = inst.contract;

    // Compute installmentTotal using same rounding as 2A
    const total = new Decimal(c.totalMonths);
    const financed = new Decimal(c.financedAmount.toString());
    const commission =
      c.storeCommission != null
        ? new Decimal(c.storeCommission.toString())
        : financed.times('0.10').toDecimalPlaces(2);
    const interest = new Decimal(c.interestTotal.toString());
    const grossExclVat = financed.plus(commission).plus(interest);
    const vat =
      c.vatAmount != null
        ? new Decimal(c.vatAmount.toString())
        : grossExclVat.times('0.07').toDecimalPlaces(2);

    const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const installmentTotal = installmentExclVat.plus(vatPerInst); // 1,515.83

    const advCredit = input.advanceCredit ?? new Decimal(0);
    const advConsume = input.advanceConsume ?? new Decimal(0);
    let roundingDiff = new Decimal(0);

    if (!input.partialClear) {
      // Effective rounding diff (subject to TOLERANCE):
      //   amountReceived + advConsume - installmentTotal - advCredit
      // Advance components are explicit by design; only the rounding remainder is
      // checked against the 1฿ tolerance.
      roundingDiff = input.amountReceived
        .plus(advConsume)
        .minus(installmentTotal)
        .minus(advCredit);

      // Validate tolerance (before entering TX — fast-fail on bad input)
      if (roundingDiff.abs().gt(TOLERANCE)) {
        throw new BadRequestException(
          `Payment difference ${roundingDiff.abs().toFixed(2)} exceeds tolerance 1.00`,
        );
      }

      // Underpay requires approver
      if (roundingDiff.lt(0) && !input.toleranceApproverId) {
        throw new BadRequestException(
          'Underpay tolerance requires approver (toleranceApproverId)',
        );
      }
    }

    // Wrap Payment.create (if needed) + JE post + reversal in a single atomic transaction.
    // If JE post fails (unbalanced, missing account), any Payment row created here is rolled back.
    // When existingPaymentId is provided (caller already created the Payment row), skip Payment.create
    // and use the provided id as the JE referenceId.
    const entryNumber = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let paymentId: string;
      if (input.existingPaymentId) {
        // Caller owns the Payment row — just use its id as JE reference
        paymentId = input.existingPaymentId;
      } else {
        // Standalone: create the Payment row now (original behavior)
        const payment = await tx.payment.create({
          data: {
            contractId: c.id,
            installmentNo: inst.installmentNo,
            dueDate: inst.dueDate,
            amountDue: installmentTotal,
            amountPaid: input.amountReceived,
            paidDate: new Date(),
            paidAt: new Date(),
            status: 'PAID',
          },
        });
        paymentId = payment.id;
      }
      // Legacy variable name kept for compat with lines below
      const payment = { id: paymentId };

      const zero = new Decimal(0);

      const lines: {
        accountCode: string;
        dr: Decimal;
        cr: Decimal;
        description?: string;
      }[] = [];

      if (input.partialClear) {
        // CSV case-3 pattern: Dr cash + Cr 11-2103 = amount (partial clear)
        lines.push({
          accountCode: input.depositAccountCode,
          dr: input.amountReceived,
          cr: zero,
          description: 'รับชำระบางส่วน',
        });
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: input.amountReceived, // partial — NOT installmentTotal
          description: 'ล้างลูกหนี้ค้างชำระ (บางส่วน)',
        });
      } else {
        // 1. Cash in (skip when 0 — full advance cover edge case)
        if (input.amountReceived.gt(0)) {
          lines.push({
            accountCode: input.depositAccountCode,
            dr: input.amountReceived,
            cr: zero,
            description: 'รับเงิน',
          });
        }

        // 2. Consume existing advance
        if (advConsume.gt(0)) {
          lines.push({
            accountCode: '21-1103',
            dr: advConsume,
            cr: zero,
            description: 'หักเงินรับล่วงหน้า',
          });
        }

        // 3. Underpay rounding
        if (roundingDiff.lt(0)) {
          lines.push({
            accountCode: '52-1104',
            dr: roundingDiff.abs(),
            cr: zero,
            description: 'ส่วนลดเศษสตางค์ (Policy C)',
          });
        }

        // 4. Clear receivable (always)
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: installmentTotal,
          description: 'ล้างลูกหนี้ค้างชำระ',
        });

        // 5. Park new advance
        if (advCredit.gt(0)) {
          lines.push({
            accountCode: '21-1103',
            dr: zero,
            cr: advCredit,
            description: 'เงินรับล่วงหน้า',
          });
        }

        // 6. Overpay rounding
        if (roundingDiff.gt(0)) {
          lines.push({
            accountCode: '53-1503',
            dr: zero,
            cr: roundingDiff,
            description: 'กำไรปัดเศษ (Policy C)',
          });
        }
      }

      const result = await this.journal.createAndPost(
        {
          description: `รับชำระงวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
          reference: payment.id,
          metadata: {
            tag: '2B',
            contractId: c.id,
            installmentScheduleId: inst.id,
            paymentId: payment.id,
            toleranceApproverId: input.toleranceApproverId,
          },
          lines,
        },
        tx,
      );

      // Feature I: if this installment had a 60-day mandatory VAT JE posted,
      // trigger the reversal now that the customer has paid (inside same TX).
      if (this.vat60Reversal && inst.vat60dayJournalEntryId) {
        await this.vat60Reversal.execute(inst.id, tx);
      }

      return result.entryNumber;
    });

    return { entryNo: entryNumber };
  }
}
