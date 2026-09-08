import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addBkkDays, addBkkMonths } from '../../utils/date.util';

export type RescheduleVariant = '6a' | '6b';

export interface RescheduleInput {
  contractId: string;
  fromInstallmentNo: number;
  daysToShift: number;
  /** Quoted new due date for the initiating installment, including a PAID 6b installment. */
  scheduleAnchor?: { installmentNo: number; dueDate: Date };
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
   *      on the quoted monthly day, clamped at month-end without drift.
   *      PAID installments retain both schedule and Payment history.
   *   2. Keep installment amounts unchanged; the collect service parks the fee.
   *   3. Write AuditLog action=RESCHEDULE if userId provided.
   *      (consecutiveMissed is now derived — no persisted field to reset)
   *
   * The JP6 JE post (recordFeeAdvance / recordBundledPayment) is intentionally
   * outside this transaction — per CSV golden case-6a/6b: "Step 1 — UPDATE DB
   * (ไม่มี Journal)" comes before any JE. The JE is posted later when the
   * customer actually pays (Step 2/3 of the CSV).
   *
   * `outerTx` (ปรับดิว collect-first, 2026-07-02): when provided, ALL writes run on
   * the caller's transaction so the collect JE + lateFee reset + date shift commit
   * as ONE atom (RescheduleCollectService). Without it, behaviour is unchanged —
   * the service opens its own $transaction.
   */
  async execute(
    input: RescheduleInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<RescheduleResult> {
    const readClient: Prisma.TransactionClient | PrismaService = outerTx ?? this.prisma;
    const candidates = await readClient.installmentSchedule.findMany({
      where: {
        contractId: input.contractId,
        installmentNo: { gte: input.fromInstallmentNo },
        deletedAt: null,
      } as any,
      orderBy: { installmentNo: 'asc' },
    });
    const paidPayments = await readClient.payment.findMany({
      where: {
        contractId: input.contractId,
        installmentNo: { gte: input.fromInstallmentNo },
        deletedAt: null,
        status: 'PAID',
      },
      select: { installmentNo: true },
    });
    const paidInstallmentNos = new Set(paidPayments.map((payment) => payment.installmentNo));
    const installments = candidates.filter((inst) => !paidInstallmentNos.has(inst.installmentNo));
    if (!installments.length) {
      throw new NotFoundException('No installments to reschedule');
    }

    // Use contract.monthlyPayment as the installment total (includes commission + VAT).
    // installment.amountDue only carries principal+interest+vat and does not include commission,
    // so it would undercount the reschedule fee.
    const contract = await readClient.contract.findUniqueOrThrow({
      where: { id: input.contractId },
      select: { monthlyPayment: true },
    });
    const firstInstTotal = new Decimal(contract.monthlyPayment.toString());

    // Reschedule fee = monthlyPayment / 30 × daysToShift, rounded UP to a whole baht
    // (owner policy 2026-06 — ปัดเศษขึ้นเต็มบาท). e.g. 1515.83/30×22 = 1111.6086 → 1112.
    // Must stay identical to computeRescheduleQuote (reschedule-quote.util.ts) — the
    // collect service asserts the two agree before posting money.
    const fee = firstInstTotal
      .div(30)
      .times(input.daysToShift)
      .toDecimalPlaces(0, Decimal.ROUND_UP);

    const body = async (tx: Prisma.TransactionClient) => {
      const oldDueDates: Record<string, Date> = {};
      const newDueDates: Record<string, Date> = {};
      const shiftedIds: string[] = [];

      const anchor = input.scheduleAnchor ?? {
        installmentNo: installments[0].installmentNo,
        dueDate: addBkkDays(installments[0].dueDate, input.daysToShift),
      };
      for (const inst of installments) {
        // Use installment numbers, not array indexes: PAID or missing rows must
        // keep their calendar slot. Never add days to each old monthly due date.
        const newDue = addBkkMonths(anchor.dueDate, inst.installmentNo - anchor.installmentNo);
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

      // (Removed 2026-07-02, review C1) The old "reduce last installment
      // amountDue by fee" wrote InstallmentSchedule.amountDue — a field NO
      // billing path reads (Payment.amountDue + computeInstallmentBreakdown
      // drive billing/accrual), so the reduction was write-only and the fee's
      // 21-1103 credit was never relieved. The CPA case-6a prepayment is now
      // realised through Contract.advanceBalance (RescheduleCollectService),
      // which the existing advance machinery consumes against real installments.

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
              anchorInstallmentNo: anchor.installmentNo,
              anchorNewDueDate: anchor.dueDate.toISOString(),
              rescheduleFee: fee.toFixed(2),
              shiftedInstallmentCount: installments.length,
              firstShiftedInstallmentNo: installments[0].installmentNo,
              firstShiftedOldDue: installments[0].dueDate.toISOString(),
              firstShiftedNewDue: newDueDates[installments[0].id].toISOString(),
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
    };

    return outerTx ? body(outerTx) : this.prisma.$transaction(body);
  }
}
