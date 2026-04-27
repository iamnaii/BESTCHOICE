import { Injectable, BadRequestException } from '@nestjs/common';
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
  async createPromise(input: CreatePromiseInput) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const oldPromise = await this.prisma.callLog.findFirst({
        where: {
          contractId: input.contractId,
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
        cycleStartedAt = (oldPromise as any).cycleStartedAt ?? now;
        cycleDeadline =
          (oldPromise as any).cycleDeadline ??
          (await this.calcCycleDeadline(input.contractId, now));
        rescheduleCount = (oldPromise as any).rescheduleCount + 1;

        const oldHasPastDueSlot = ((oldPromise as any).slots as any[]).some(
          (s: any) => s.settlementDate.getTime() < now.getTime(),
        );
        const shouldCountBroken = oldHasPastDueSlot || rescheduleCount >= 2;

        await (tx as any).callLog.update({
          where: { id: oldPromise.id },
          data: {
            supersededAt: now,
            ...(shouldCountBroken ? { brokenAt: now } : {}),
          },
        });

        if (shouldCountBroken) {
          await (tx as any).auditLog.create({
            data: {
              action: 'BROKEN_PROMISE',
              entity: 'Contract',
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

      // Validate every slot is within cycle deadline — only enforced when rescheduling
      // (i.e. there was an existing active promise whose cycle deadline must be respected).
      if (oldPromise) {
        for (const slot of input.slots) {
          if (slot.settlementDate.getTime() > cycleDeadline.getTime()) {
            throw new BadRequestException(
              `วันที่นัดเกินเพดานรอบ (cycleDeadline = ${cycleDeadline.toISOString().slice(0, 10)})`,
            );
          }
        }
      }

      // Sort slots ascending — primary = earliest
      const sortedSlots = [...input.slots].sort(
        (a, b) => a.settlementDate.getTime() - b.settlementDate.getTime(),
      );
      const primary = sortedSlots[0];

      const newPromise = await (tx as any).callLog.create({
        data: {
          contractId: input.contractId,
          userId: input.userId,
          result: 'PROMISED',
          notes: input.notes,
          settlementDate: primary.settlementDate,
          settlementAmount: primary.settlementAmount as any,
          rescheduleCount,
          cycleStartedAt,
          cycleDeadline,
          targetInstallmentIds: input.targetInstallmentIds,
        },
      });

      if (oldPromise) {
        await (tx as any).callLog.update({
          where: { id: oldPromise.id },
          data: { supersededByCallLogId: newPromise.id },
        });
      }

      await (tx as any).promiseSlot.createMany({
        data: sortedSlots.map((s, idx) => ({
          callLogId: newPromise.id,
          slotIndex: idx + 1,
          settlementDate: s.settlementDate,
          settlementAmount: s.settlementAmount as any,
          notes: s.notes,
        })),
      });

      return newPromise;
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
