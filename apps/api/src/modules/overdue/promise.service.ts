import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
