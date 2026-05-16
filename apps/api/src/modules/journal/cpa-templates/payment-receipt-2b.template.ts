import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Vat60dayReversalTemplate } from './vat-60day-reversal.template';
import { AccountRoleService } from '../account-role.service';

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
  /**
   * Late fee charged for overdue payments (CPA case 6 — ค่าปรับชำระล่าช้า).
   * - <3 days overdue: 50฿
   * - ≥3 days overdue: 100฿
   * Posted as Cr 42-1103 (ค่าปรับชำระล่าช้า, รายได้).
   * Cash leg increases by lateFee amount.
   * Caller computes via calcLateFee(overdue_days) helper.
   */
  lateFee?: Decimal;
}

/**
 * Calculate late fee per CPA spec (สรุปการบันทึกรับชำระค่างวด.csv กรณีที่ 6).
 * - 0 days overdue: no fee
 * - 1-2 days: 50฿
 * - 3+ days: 100฿
 */
export function calcLateFee(overdueDays: number): Decimal {
  if (overdueDays <= 0) return new Decimal(0);
  if (overdueDays < 3) return new Decimal(50);
  return new Decimal(100);
}

/**
 * Calculate postpone fee (ค่าปรับดิว) — daily-prorated rescheduling charge.
 * Formula: monthlyPayment ÷ 30 × daysToShift, rounded DOWN to 2dp.
 * ROUND_DOWN per CPA Policy A spec — matches the hand-computed examples
 * provided by the accountant; HALF_UP would produce off-by-0.01 deltas.
 * Posted as Cr 21-1103 (เงินรับล่วงหน้า) via RescheduleJP6Template.recordFeeAdvance.
 */
export function calcPostponeFee(monthlyPayment: Decimal, daysToShift: number): Decimal {
  if (daysToShift <= 0) return new Decimal(0);
  return monthlyPayment.div(30).times(daysToShift).toDecimalPlaces(2, Decimal.ROUND_DOWN);
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
    private readonly roles: AccountRoleService,
    @Optional() private readonly vat60Reversal?: Vat60dayReversalTemplate,
  ) {}

  async execute(
    input: PaymentReceiptInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    // C2 fix support: when an outerTx is provided (e.g. PaySolutions webhook),
    // run the JE + Payment.create + VAT-reversal inside that tx so the whole
    // financial event is atomic. When omitted, open a local tx (legacy behavior).
    const readClient: Prisma.TransactionClient | PrismaService = outerTx ?? this.prisma;

    // Pre-fetch for validation (read-only) — uses outerTx when supplied so it
    // sees uncommitted Payment rows from the caller's tx.
    const inst = await readClient.installmentSchedule.findUniqueOrThrow({
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
    const lateFee = input.lateFee ?? new Decimal(0);
    let roundingDiff = new Decimal(0);

    if (!input.partialClear) {
      // Effective rounding diff (subject to TOLERANCE):
      //   amountReceived + advConsume - installmentTotal - advCredit - lateFee
      // Late fee is collected on top of the installment (CPA case 6).
      // Advance components are explicit by design; only the rounding remainder is
      // checked against the 1฿ tolerance.
      roundingDiff = input.amountReceived
        .plus(advConsume)
        .minus(installmentTotal)
        .minus(advCredit)
        .minus(lateFee);

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
    // C2 fix: when caller provides outerTx, run inside that tx so the JE + the
    // caller's Payment.update form a single atomic financial event.
    const exec = async (tx: Prisma.TransactionClient) => {
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
            accountCode: this.roles.code('adj_underpay'),
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

        // 7. Late fee income (CPA case 6 — ค่าปรับชำระล่าช้า)
        if (lateFee.gt(0)) {
          lines.push({
            accountCode: '42-1103',
            dr: zero,
            cr: lateFee,
            description: 'ค่าปรับชำระล่าช้า',
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
    };

    const entryNumber = outerTx ? await exec(outerTx) : await this.prisma.$transaction(exec);

    return { entryNo: entryNumber };
  }
}
