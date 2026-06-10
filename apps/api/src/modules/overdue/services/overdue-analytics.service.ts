import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Read-only analytics helpers shared across the overdue sub-services.
 *
 * Extracted from OverdueService as part of the behaviour-preserving decompose.
 * Built FIRST by the facade because ContactLog + Governance hold a ref to it
 * (getBrokenPromiseCount) and ContactLog also drives computeFifoTargets.
 *
 * Bodies are verbatim from the original OverdueService (only the dep resolution
 * `this.prisma` and import paths changed).
 */
export class OverdueAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * นับจำนวนครั้งที่ลูกค้าผิดนัดบนสัญญานี้ (lifetime).
   * Source: AuditLog rows ที่ action='BROKEN_PROMISE' บน contract.
   * (BrokenPromiseCron / promise-resolution.cron เป็นตัวสร้าง entry)
   */
  async getBrokenPromiseCount(contractId: string): Promise<number> {
    return this.prisma.auditLog.count({
      where: {
        // Accept both casings: new code writes 'contract' (per audit.service.ts
        // convention), legacy broken-promise.cron wrote 'Contract'. Mirrors the
        // dual-read in queue.service.ts so recent rows aren't silently missed.
        entity: { in: ['contract', 'Contract'] },
        entityId: contractId,
        action: 'BROKEN_PROMISE',
      },
    });
  }

  /**
   * Returns the IDs of unpaid installments that FIFO-allocate up to targetAmount.
   * Used when the caller does not explicitly specify targetInstallmentIds.
   */
  async computeFifoTargets(contractId: string, targetAmount: number): Promise<string[]> {
    // C1 fix: use status filter (consistent with getBoardData / logContact unpaid-check)
    // rather than paidAt: null, which misses manual payments (which set paidDate not paidAt).
    const payments = await this.prisma.payment.findMany({
      where: {
        contractId,
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      select: {
        id: true,
        dueDate: true,
        amountDue: true,
        amountPaid: true,
      },
      orderBy: { dueDate: 'asc' },
    });

    const { Decimal } = await import('@prisma/client/runtime/library');
    const { allocateFifo } = await import('../installment-allocator.util');

    return allocateFifo(
      payments.map((p) => ({
        id: p.id,
        dueDate: p.dueDate,
        remainingAmount: (p.amountDue as any).sub(p.amountPaid as any),
      })),
      new Decimal(targetAmount),
    );
  }
}
