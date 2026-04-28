import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreatePromiseSlotInput {
  settlementDate: Date;
  settlementAmount: number | string;
  notes?: string;
}

export interface CreatePromiseInput {
  contractId: string;
  userId: string;
  slots: CreatePromiseSlotInput[];
  targetInstallmentIds: string[];
  notes?: string;
}

@Injectable()
export class PromiseService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cycle deadline = next installment dueDate > now, else last day of next calendar month.
   * Spec section 2.1.
   */
  async calcCycleDeadline(contractId: string, now: Date = new Date()): Promise<Date> {
    // In this codebase, Payment records ARE the installments (each payment = one installment).
    const installments = await this.prisma.payment.findMany({
      where: { contractId, deletedAt: null },
      select: { dueDate: true },
    });

    const future = installments
      .map((i) => i.dueDate)
      .filter((d) => d.getTime() > now.getTime())
      .sort((a, b) => a.getTime() - b.getTime());

    if (future.length > 0) return future[0];

    // Fallback: last day of next calendar month
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    nextMonth.setHours(23, 59, 59, 999);
    return nextMonth;
  }

  /**
   * Creates a new promise for a contract, superseding any active promise.
   * Broken promise tracking via BROKEN_PROMISE AuditLog (matches queue.service pattern).
   * Rules:
   *   - reschedule #1 before due → supersede only (no broken)
   *   - reschedule #2+ before due → supersede + BROKEN_PROMISE audit
   *   - reschedule after any slot is past due → supersede + BROKEN_PROMISE audit
   *   - slot.settlementDate > cycleDeadline → BadRequestException
   */
  async createPromise(input: CreatePromiseInput, externalTx?: Prisma.TransactionClient) {
    const now = new Date();

    const run = async (tx: Prisma.TransactionClient) => {
      // H3 fix: validate targetInstallmentIds belong to this contract before storing them.
      if (input.targetInstallmentIds.length > 0) {
        const ownedCount = await tx.payment.count({
          where: {
            id: { in: input.targetInstallmentIds },
            contractId: input.contractId,
            deletedAt: null,
          },
        });
        if (ownedCount !== input.targetInstallmentIds.length) {
          throw new BadRequestException('งวดที่เลือกไม่ตรงกับสัญญานี้');
        }
      }

      // C2 fix: use tx (not this.prisma) so concurrent calls see each other's pending writes
      // and two collectors cannot both create an active promise for the same contract.
      // N3 fix: $transaction below uses Serializable isolation so the read+write phases
      // serialize end-to-end, eliminating the race where two creators both find no
      // oldPromise and both create new ones.
      const oldPromise = await tx.callLog.findFirst({
        where: {
          contractId: input.contractId,
          deletedAt: null,
          result: 'PROMISED',
          brokenAt: null,
          supersededAt: null,
          keptAt: null,
          canceledAt: null,
        },
        include: { slots: { orderBy: { slotIndex: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });

      let cycleStartedAt: Date;
      let cycleDeadline: Date;
      let rescheduleCount = 0;

      if (oldPromise) {
        cycleStartedAt = oldPromise.cycleStartedAt ?? now;
        cycleDeadline =
          oldPromise.cycleDeadline ??
          (await this.calcCycleDeadline(input.contractId, now));
        rescheduleCount = oldPromise.rescheduleCount + 1;

        const oldHasPastDueSlot = oldPromise.slots.some(
          (s) => s.settlementDate.getTime() < now.getTime(),
        );
        const shouldCountBroken = oldHasPastDueSlot || rescheduleCount >= 2;

        await tx.callLog.update({
          where: { id: oldPromise.id },
          data: {
            supersededAt: now,
            ...(shouldCountBroken ? { brokenAt: now } : {}),
          },
        });

        if (shouldCountBroken) {
          await tx.auditLog.create({
            data: {
              action: 'BROKEN_PROMISE',
              entity: 'contract',
              entityId: input.contractId,
              userId: input.userId,
              newValue: {
                supersededCallLogId: oldPromise.id,
                reason: oldHasPastDueSlot
                  ? 'PAST_DUE_AT_RESCHEDULE'
                  : 'RESCHEDULE_COUNT_EXCEEDED',
                rescheduleCount,
              },
              ipAddress: '',
            },
          });
        }
      } else {
        cycleStartedAt = now;
        cycleDeadline = await this.calcCycleDeadline(input.contractId, now);
      }

      // M1 fix: enforce cycleDeadline on every slot, including first-promise creation —
      // otherwise a collector could log a slot months past the contract's grace window.
      for (const slot of input.slots) {
        if (slot.settlementDate.getTime() > cycleDeadline.getTime()) {
          throw new BadRequestException(
            `วันที่นัดเกินเพดานรอบ (cycleDeadline = ${cycleDeadline.toISOString().slice(0, 10)})`,
          );
        }
      }

      // Sort slots ascending — primary = earliest
      const sortedSlots = [...input.slots].sort(
        (a, b) => a.settlementDate.getTime() - b.settlementDate.getTime(),
      );
      const primary = sortedSlots[0];

      // C4 fix: calledAt is non-nullable in CallLog with no DB default — must supply it.
      // C4 fix: CallLog has no `userId` field; the user attribution column is `callerId`.
      //         input.userId (the collector's user ID) maps to callerId storage.
      const newPromise = await tx.callLog.create({
        data: {
          contractId: input.contractId,
          callerId: input.userId,
          calledAt: now,
          result: 'PROMISED',
          notes: input.notes,
          settlementDate: primary.settlementDate,
          settlementAmount: primary.settlementAmount as never,
          rescheduleCount,
          cycleStartedAt,
          cycleDeadline,
          targetInstallmentIds: input.targetInstallmentIds,
        },
      });

      if (oldPromise) {
        await tx.callLog.update({
          where: { id: oldPromise.id },
          data: { supersededByCallLogId: newPromise.id },
        });
      }

      await tx.promiseSlot.createMany({
        data: sortedSlots.map((s, idx) => ({
          callLogId: newPromise.id,
          slotIndex: idx + 1,
          settlementDate: s.settlementDate,
          settlementAmount: s.settlementAmount as never,
          notes: s.notes,
        })),
      });

      return newPromise;
    };

    if (externalTx) return run(externalTx);
    return this.prisma.$transaction(run, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  /**
   * Returns the single active promise for a contract.
   * Active = result PROMISED, not broken/superseded/kept/canceled.
   * Spec section 3.1.
   */
  async findActivePromise(contractId: string) {
    return this.prisma.callLog.findFirst({
      where: {
        contractId,
        deletedAt: null,
        result: 'PROMISED',
        brokenAt: null,
        supersededAt: null,
        keptAt: null,
        canceledAt: null,
      },
      include: {
        slots: {
          orderBy: { slotIndex: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
