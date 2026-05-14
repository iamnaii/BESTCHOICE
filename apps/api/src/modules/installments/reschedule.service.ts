import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

export type RescheduleVariant = '6a' | '6b';

export interface RescheduleInput {
  contractId: string;
  fromInstallmentNo: number;
  daysToShift: number;
  /** Optional — when provided, an AuditLog row is written inside the transaction. */
  userId?: string;
  /** Optional — recorded in AuditLog metadata for downstream JE classification. */
  variant?: RescheduleVariant;
}

export interface RescheduleResult {
  rescheduleFee: Decimal;
  shiftedInstallmentIds: string[];
  oldDueDates: Record<string, Date>;
  newDueDates: Record<string, Date>;
}

@Injectable()
export class RescheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Wave 2 / Task 4 — atomic reschedule:
   *   1. UPDATE installment_schedules.due_date for installmentNo >= fromInstallmentNo
   *      (shifted by daysToShift), so cron 2A posts the accrual on the NEW dueDate.
   *   2. Reduce last installment amountDue by reschedule fee (CSV case-6a/6b step 1).
   *   3. Reset contract.consecutiveMissed to 0 (overdue cleared).
   *   4. Write AuditLog action=RESCHEDULE if userId provided.
   *
   * The JP6 JE post (recordFeeAdvance / recordBundledPayment) is intentionally
   * outside this transaction — per CSV golden case-6a/6b: "Step 1 — UPDATE DB
   * (ไม่มี Journal)" comes before any JE. The JE is posted later when the
   * customer actually pays (Step 2/3 of the CSV).
   */
  async execute(input: RescheduleInput): Promise<RescheduleResult> {
    const installments = await this.prisma.installmentSchedule.findMany({
      where: {
        contractId: input.contractId,
        installmentNo: { gte: input.fromInstallmentNo },
        deletedAt: null,
      } as any,
      orderBy: { installmentNo: 'asc' },
    });
    if (!installments.length) {
      throw new NotFoundException('No installments to reschedule');
    }

    // Use contract.monthlyPayment as the installment total (includes commission + VAT).
    // installment.amountDue only carries principal+interest+vat and does not include commission,
    // so it would undercount the reschedule fee.
    const contract = await this.prisma.contract.findUniqueOrThrow({
      where: { id: input.contractId },
      select: { monthlyPayment: true },
    });
    const firstInstTotal = new Decimal(contract.monthlyPayment.toString());

    const fee = firstInstTotal
      .div(30)
      .times(input.daysToShift)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN);

    return this.prisma.$transaction(async (tx) => {
      const oldDueDates: Record<string, Date> = {};
      const newDueDates: Record<string, Date> = {};
      const shiftedIds: string[] = [];

      for (const inst of installments) {
        const newDue = new Date(inst.dueDate);
        newDue.setDate(newDue.getDate() + input.daysToShift);
        await tx.installmentSchedule.update({
          where: { id: inst.id },
          data: {
            dueDate: newDue,
            rescheduledFromDate: inst.dueDate,
            rescheduleCount: { increment: 1 },
          } as any,
        });

        // W4 fix: shift Payment.dueDate alongside InstallmentSchedule.dueDate.
        // recordPayment reads payment.dueDate for the real-time late fee
        // recompute. Without this update, a customer paying on the new due
        // date is still flagged overdue by the original due date, and a
        // bogus lateFee is computed + booked to 42-1103.
        //
        // Round 2 W4 fix: only shift dueDate on non-PAID rows. Reschedule
        // should NEVER move a PAID row's dueDate — would corrupt historical
        // late-fee evidence + GL audit trail. Soft-deleted rows are already
        // filtered above. PaymentStatus enum = PENDING | PAID | PARTIALLY_PAID
        // | OVERDUE (no CANCELLED) so `not: 'PAID'` is the exhaustive guard.
        await tx.payment.updateMany({
          where: {
            contractId: input.contractId,
            installmentNo: inst.installmentNo,
            deletedAt: null,
            status: { not: 'PAID' },
          },
          data: { dueDate: newDue },
        });

        oldDueDates[inst.id] = inst.dueDate;
        newDueDates[inst.id] = newDue;
        shiftedIds.push(inst.id);
      }

      // Reduce last installment amountDue by fee
      const last = installments[installments.length - 1];
      await tx.installmentSchedule.update({
        where: { id: last.id },
        data: { amountDue: firstInstTotal.minus(fee) } as any,
      });

      // Reset consecutiveMissed if field exists (safe to skip if not present)
      try {
        await (tx.contract as any).update({
          where: { id: input.contractId },
          data: { consecutiveMissed: 0 },
        });
      } catch {
        // field does not exist on schema — safe to skip
      }

      // AuditLog (only when caller provides a real userId — keeps the
      // existing test signature backward-compatible until callers are wired)
      if (input.userId) {
        await tx.auditLog.create({
          data: {
            action: 'RESCHEDULE',
            entity: 'contract',
            entityId: input.contractId,
            userId: input.userId,
            newValue: {
              fromInstallmentNo: input.fromInstallmentNo,
              daysToShift: input.daysToShift,
              variant: input.variant ?? null,
              rescheduleFee: fee.toFixed(2),
              shiftedInstallmentCount: installments.length,
              firstShiftedInstallmentNo: installments[0].installmentNo,
              firstShiftedOldDue: installments[0].dueDate.toISOString(),
              firstShiftedNewDue: newDueDates[installments[0].id].toISOString(),
              lastInstallmentNewAmountDue: firstInstTotal.minus(fee).toFixed(2),
            },
          },
        });
      }

      return {
        rescheduleFee: fee,
        shiftedInstallmentIds: shiftedIds,
        oldDueDates,
        newDueDates,
      };
    });
  }
}
