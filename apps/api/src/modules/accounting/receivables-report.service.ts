import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { agingBucket } from '../../utils/aging-bucket.util';

@Injectable()
export class ReceivablesReportService {
  constructor(private prisma: PrismaService) {}

  // ─── P4-SP1: Aging Report ────────────────────────────────────────────────

  async getAgingReport(asOf: Date) {
    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lt: asOf },
        deletedAt: null,
      },
      include: {
        contract: {
          include: {
            customer: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
    });

    const summary = {
      bucket_0_30: 0,
      bucket_31_60: 0,
      bucket_61_90: 0,
      bucket_90_plus: 0,
    };

    const customerMap = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        phone: string;
        totalOverdue: number;
        daysOverdue: number;
        bucket: string;
        contracts: number;
      }
    >();

    const calcBucket = (days: number): keyof typeof summary =>
      agingBucket(days, ['bucket_0_30', 'bucket_31_60', 'bucket_61_90', 'bucket_90_plus'] as const);

    for (const p of overduePayments) {
      const daysOverdue = Math.floor(
        (asOf.getTime() - p.dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const remaining = Number(p.amountDue) - Number(p.amountPaid ?? 0);
      if (remaining <= 0) continue;

      const bucket = calcBucket(daysOverdue);
      summary[bucket] += remaining;

      const cid = p.contract.customer.id;
      const existing = customerMap.get(cid);
      if (existing) {
        existing.totalOverdue += remaining;
        existing.daysOverdue = Math.max(existing.daysOverdue, daysOverdue);
        existing.bucket = calcBucket(existing.daysOverdue);
      } else {
        customerMap.set(cid, {
          customerId: cid,
          customerName: p.contract.customer.name,
          phone: p.contract.customer.phone ?? '',
          totalOverdue: remaining,
          daysOverdue,
          bucket,
          contracts: 1,
        });
      }
    }

    return {
      asOf,
      summary,
      customers: Array.from(customerMap.values()).sort(
        (a, b) => b.daysOverdue - a.daysOverdue,
      ),
    };
  }

  // ─── P4-SP1 Task 3: Bad Debt Report ─────────────────────────────────────────

  /**
   * Returns journal lines posted to account 51-1102 (หนี้สูญ/ขาดทุนจากยึดเครื่อง)
   * within the given period. Used by BadDebtReportPage to display write-off history.
   *
   * Per .claude/rules/accounting.md:
   *   51-1102 = หนี้สูญ/ขาดทุนจากยึดเครื่อง (RepossessionJP5Template loss branch)
   */
  async getBadDebtReport(periodStart: Date, periodEnd: Date, companyId?: string) {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: '51-1102',
        journalEntry: {
          postedAt: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            description: true,
            postedAt: true,
            referenceType: true,
            referenceId: true,
          },
        },
      },
      orderBy: { journalEntry: { postedAt: 'desc' } },
    });

    const total = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0);

    return {
      period: { start: periodStart, end: periodEnd },
      totalBadDebt: total,
      entries: lines.map((l) => ({
        journalEntryId: l.journalEntry.id,
        documentNumber: l.journalEntry.entryNumber,
        postedAt: l.journalEntry.postedAt,
        description: l.description ?? l.journalEntry.description,
        amount: Number(l.debit ?? 0),
        sourceType: l.journalEntry.referenceType,
        sourceId: l.journalEntry.referenceId,
      })),
    };
  }
}
