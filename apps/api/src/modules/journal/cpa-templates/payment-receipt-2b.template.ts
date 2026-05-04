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

    const diff = input.amountReceived.minus(installmentTotal); // + overpay, - underpay

    // Validate tolerance (before entering TX — fast-fail on bad input)
    if (diff.abs().gt(TOLERANCE)) {
      throw new BadRequestException(
        `Payment difference ${diff.abs().toFixed(2)} exceeds tolerance 1.00`,
      );
    }

    // Underpay requires approver
    if (diff.lt(0) && !input.toleranceApproverId) {
      throw new BadRequestException(
        'Underpay tolerance requires approver (toleranceApproverId)',
      );
    }

    // Wrap Payment.create + JE post + reversal in a single atomic transaction.
    // If JE post fails (unbalanced, missing account), Payment row is rolled back — no orphans.
    const entryNumber = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create a Payment row to use as unique referenceId (avoids collision with 2A's installmentScheduleId)
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

      const zero = new Decimal(0);

      const lines: {
        accountCode: string;
        dr: Decimal;
        cr: Decimal;
        description?: string;
      }[] = [
        {
          accountCode: input.depositAccountCode,
          dr: input.amountReceived,
          cr: zero,
          description: 'รับเงิน',
        },
      ];

      if (diff.gt(0)) {
        // Overpay — split credit between receivable + rounding gain
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: installmentTotal,
          description: 'ล้างลูกหนี้ค้างชำระ',
        });
        lines.push({
          accountCode: '53-1503',
          dr: zero,
          cr: diff,
          description: 'กำไรปัดเศษ (Policy C)',
        });
      } else if (diff.lt(0)) {
        // Underpay — add discount expense
        lines.push({
          accountCode: '52-1104',
          dr: diff.abs(),
          cr: zero,
          description: 'ส่วนลดเศษสตางค์ (Policy C)',
        });
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: installmentTotal,
          description: 'ล้างลูกหนี้ค้างชำระ',
        });
      } else {
        // Exact — simple credit
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: installmentTotal,
          description: 'ล้างลูกหนี้ค้างชำระ',
        });
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
