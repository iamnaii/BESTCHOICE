import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

const TOLERANCE = new Decimal('1.00');

export interface PaymentReceiptSplitInput {
  installmentScheduleId: string;
  partialAmount: Decimal;
  depositAccountCode: string;
  isFinalPartial: boolean;
  toleranceApproverId?: string;
}

/**
 * Template 2B-split — Payment Receipt for Case 3 (split / partial payments).
 *
 * Design note: Payment has @@unique([contractId, installmentNo]) so only one
 * Payment row can exist per installment. For split payments:
 * - Non-final partials: JE only (no Payment row). Reference = generated UUID.
 *   Prior partial sums are tracked via 2B-partial JEs in metadata.
 * - Final partial: creates the single Payment row (amountPaid = full installmentTotal).
 *   Prior sum is computed by summing 2B-partial JE debit lines for this installment.
 *
 * Non-final partial JE:
 *   Dr depositAccountCode   partialAmount
 *     Cr 11-2103 ลูกหนี้ค้างชำระ  partialAmount
 *
 * Final partial JE (closes receivable, with tolerance routing):
 *   Exact (diff == 0):
 *     Dr depositAccountCode   partialAmount
 *       Cr 11-2103 ลูกหนี้ค้างชำระ  partialAmount
 *   Overpay (diff > 0, ≤1฿):
 *     Dr depositAccountCode   partialAmount
 *       Cr 11-2103 ลูกหนี้ค้างชำระ  remainingReceivable
 *       Cr 53-1503 กำไรปัดเศษ        diff
 *   Underpay (diff < 0, ≤1฿, requires approverId):
 *     Dr depositAccountCode   partialAmount
 *     Dr 52-1104 ส่วนลดเศษสตางค์  abs(diff)
 *       Cr 11-2103 ลูกหนี้ค้างชำระ  remainingReceivable
 *
 * Reject: abs(diff) > 1.00 → BadRequestException 'exceeds tolerance'
 * Reject: final underpay without toleranceApproverId → BadRequestException 'approver'
 */
@Injectable()
export class PaymentReceipt2BSplitTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * D1.1.6.3 — read `adj_auto_route` flag (default TRUE).
   * Inlined direct SystemConfig read to avoid pulling SettingsModule into the
   * journal module DI graph. Mirrors the helper in PaymentReceipt2BTemplate.
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

  private computeInstallmentTotal(c: {
    totalMonths: number;
    financedAmount: Decimal | any;
    storeCommission: Decimal | null | any;
    interestTotal: Decimal | any;
    vatAmount: Decimal | null | any;
  }): Decimal {
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
    return installmentExclVat.plus(vatPerInst);
  }

  /**
   * Sum prior non-final partial amounts from JEs tagged '2B' + partial=true + final=false
   * for this installmentScheduleId.
   */
  private async sumPriorPartials(
    contractId: string,
    installmentScheduleId: string,
  ): Promise<Decimal> {
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: contractId } } as any,
          { metadata: { path: ['tag'], equals: '2B' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: installmentScheduleId } } as any,
          { metadata: { path: ['partial'], equals: true } } as any,
          { metadata: { path: ['final'], equals: false } } as any,
        ],
      },
      include: { lines: true },
    });

    // Sum debit side of the deposit account lines (first line = cash debit)
    return entries.reduce((acc, entry) => {
      const cashLine = entry.lines.find((l) => new Decimal(l.debit.toString()).gt(0));
      return cashLine ? acc.plus(new Decimal(cashLine.debit.toString())) : acc;
    }, new Decimal('0'));
  }

  async executePartial(input: PaymentReceiptSplitInput): Promise<{ entryNo: string }> {
    const inst = await this.prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: input.installmentScheduleId },
      include: { contract: true },
    });

    const c = inst.contract;
    const installmentTotal = this.computeInstallmentTotal(c);

    // Get prior partial sum from JEs (not Payment rows — only one Payment row per installment allowed)
    const priorSum = await this.sumPriorPartials(c.id, inst.id);

    if (input.isFinalPartial) {
      const grandTotal = priorSum.plus(input.partialAmount);
      const diff = grandTotal.minus(installmentTotal); // + overpay, - underpay

      if (diff.abs().gt(TOLERANCE)) {
        throw new BadRequestException(
          `Payment difference ${diff.abs().toFixed(2)} exceeds tolerance 1.00`,
        );
      }

      if (diff.lt(0) && !input.toleranceApproverId) {
        throw new BadRequestException(
          'Underpay tolerance requires approver (toleranceApproverId)',
        );
      }

      // D1.1.6.3 — when `adj_auto_route` flag is off, refuse to auto-route
      // the final-partial rounding diff to 52-1104 / 53-1503. Owner must
      // clear the diff manually before the final partial can post.
      if (!diff.eq(0)) {
        const autoRoute = await this.readAdjAutoRouteFlag(this.prisma);
        if (!autoRoute) {
          throw new BadRequestException(
            'Auto-routing disabled — manual adjustment required',
          );
        }
      }
    }

    // For final partial: create the Payment row (one per installment, unique constraint)
    // For non-final: no Payment row, use a generated UUID as JE reference
    let referenceId: string;
    let paymentId: string | undefined;

    if (input.isFinalPartial) {
      const payment = await this.prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo: inst.installmentNo,
          dueDate: inst.dueDate,
          amountDue: installmentTotal,
          amountPaid: installmentTotal, // total installment amount — represents full installment paid via splits
          paidDate: new Date(),
          paidAt: new Date(),
          status: 'PAID',
        },
      });
      referenceId = payment.id;
      paymentId = payment.id;
    } else {
      referenceId = randomUUID();
    }

    const zero = new Decimal(0);
    const lines: {
      accountCode: string;
      dr: Decimal;
      cr: Decimal;
      description?: string;
    }[] = [];

    if (!input.isFinalPartial) {
      // Non-final: simple Dr cash / Cr receivable for partialAmount
      lines.push({
        accountCode: input.depositAccountCode,
        dr: input.partialAmount,
        cr: zero,
        description: 'รับชำระบางส่วน',
      });
      lines.push({
        accountCode: '11-2103',
        dr: zero,
        cr: input.partialAmount,
        description: 'ล้างลูกหนี้ค้างชำระ (บางส่วน)',
      });
    } else {
      // Final partial — close out remaining receivable
      const grandTotal = priorSum.plus(input.partialAmount);
      const diff = grandTotal.minus(installmentTotal);
      const remainingReceivable = installmentTotal.minus(priorSum);

      lines.push({
        accountCode: input.depositAccountCode,
        dr: input.partialAmount,
        cr: zero,
        description: 'รับชำระบางส่วน (ครั้งสุดท้าย)',
      });

      if (diff.gt(0)) {
        // Overpay
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: remainingReceivable,
          description: 'ล้างลูกหนี้ค้างชำระ',
        });
        lines.push({
          accountCode: '53-1503',
          dr: zero,
          cr: diff,
          description: 'กำไรปัดเศษ (Policy C)',
        });
      } else if (diff.lt(0)) {
        // Underpay
        lines.push({
          accountCode: '52-1104',
          dr: diff.abs(),
          cr: zero,
          description: 'ส่วนลดเศษสตางค์ (Policy C)',
        });
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: remainingReceivable,
          description: 'ล้างลูกหนี้ค้างชำระ',
        });
      } else {
        // Exact
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: input.partialAmount,
          description: 'ล้างลูกหนี้ค้างชำระ (ครบ)',
        });
      }
    }

    const result = await this.journal.createAndPost({
      description: `รับชำระงวด #${inst.installmentNo} (บางส่วน${input.isFinalPartial ? ' — สุดท้าย' : ''}) — สัญญา ${c.contractNumber}`,
      reference: referenceId,
      metadata: {
        tag: '2B',
        contractId: c.id,
        installmentScheduleId: inst.id,
        paymentId,
        partial: true,
        final: input.isFinalPartial,
        toleranceApproverId: input.toleranceApproverId,
      },
      lines,
    });

    return { entryNo: result.entryNumber };
  }
}
