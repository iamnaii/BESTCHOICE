import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { calculateDaysOverdue, calculateDaysElapsed } from '../../../utils/date.util';

@Injectable()
export class DashboardCollectionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Top 10 overdue customers
   */
  async getTopOverdue(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};

    const contracts = await this.prisma.contract.findMany({
      where: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null, ...branchFilter },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { name: true } },
        payments: {
          where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
          select: { amountDue: true, amountPaid: true, lateFee: true, dueDate: true },
        },
      },
      take: 20,
    });

    const results = contracts.map((c) => {
      const totalOutstanding = c.payments.reduce(
        (sum, p) => sum
          .add(new Prisma.Decimal(p.amountDue ?? 0))
          .sub(new Prisma.Decimal(p.amountPaid ?? 0))
          .add(new Prisma.Decimal(p.lateFee ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber();
      const oldestDue = c.payments.length > 0
        ? c.payments.reduce((oldest, p) => {
            const d = new Date(p.dueDate);
            return d < oldest ? d : oldest;
          }, new Date(c.payments[0].dueDate))
        : new Date();
      const daysOverdue = calculateDaysOverdue(oldestDue);

      return {
        contractNumber: c.contractNumber,
        customer: c.customer,
        branch: c.branch.name,
        status: c.status,
        overdueInstallments: c.payments.length,
        totalOutstanding,
        daysOverdue,
      };
    });

    return results
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding)
      .slice(0, 10);
  }

  /**
   * Aging summary: overdue payments grouped by age buckets
   */
  async getAgingSummary(branchId?: string) {
    const now = new Date();
    const branchFilter = branchId
      ? { contract: { branchId, deletedAt: null } }
      : { contract: { deletedAt: null } };

    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        dueDate: { lt: now },
        ...branchFilter,
      },
      select: { amountDue: true, amountPaid: true, lateFee: true, dueDate: true },
    });

    const bucketDefs = [
      { range: '1-30', min: 1, max: 30, color: 'green' },
      { range: '31-60', min: 31, max: 60, color: 'yellow' },
      { range: '61-90', min: 61, max: 90, color: 'orange' },
      { range: '90+', min: 91, max: Infinity, color: 'red' },
    ];

    const buckets = bucketDefs.map((def) => {
      const items = overduePayments.filter((p) => {
        const days = calculateDaysElapsed(p.dueDate, now);
        return days >= def.min && days <= def.max;
      });
      const amount = items.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountDue ?? 0)).sub(new Prisma.Decimal(p.amountPaid ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber();
      return { range: def.range, count: items.length, amount, color: def.color };
    });

    const totalCount = buckets.reduce((s, b) => s + b.count, 0);
    const totalAmount = buckets.reduce((s, b) => s + b.amount, 0);

    return { buckets, total: { count: totalCount, amount: totalAmount } };
  }

  /**
   * Collection Dashboard metrics:
   * - Aging buckets (6 buckets)
   * - Collection rate (current & last month MoM)
   * - Collected this month (total + count)
   * - Top 10 delinquent customers
   * - Channel effectiveness (dunning actions → payment within 7 days)
   */
  async computeCollectionMetrics(branchId?: string) {
    const now = new Date();
    const branchContractFilter = branchId
      ? { contract: { branchId, deletedAt: null } }
      : { contract: { deletedAt: null } };

    // ── Aging buckets ────────────────────────────────────────────────────────
    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        dueDate: { lt: now },
        ...branchContractFilter,
      },
      select: { amountDue: true, amountPaid: true, dueDate: true },
    });

    const agingBucketDefs = [
      { label: '1-7 วัน', min: 1, max: 7 },
      { label: '8-14 วัน', min: 8, max: 14 },
      { label: '15-30 วัน', min: 15, max: 30 },
      { label: '31-60 วัน', min: 31, max: 60 },
      { label: '61-90 วัน', min: 61, max: 90 },
      { label: '90+ วัน', min: 91, max: Infinity },
    ];

    const agingBuckets = agingBucketDefs.map((def) => {
      const items = overduePayments.filter((p) => {
        const days = calculateDaysElapsed(p.dueDate, now);
        return days >= def.min && days <= def.max;
      });
      const amount = items
        .reduce(
          (s, p) =>
            s
              .add(new Prisma.Decimal(p.amountDue ?? 0))
              .sub(new Prisma.Decimal(p.amountPaid ?? 0)),
          new Prisma.Decimal(0),
        )
        .toNumber();
      return { label: def.label, min: def.min, max: def.max === Infinity ? 999999 : def.max, count: items.length, amount };
    });

    // ── Collection rate ──────────────────────────────────────────────────────
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      thisMonthDue,
      thisMonthCollected,
      prevMonthDue,
      prevMonthCollected,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          dueDate: { gte: thisMonthStart, lt: thisMonthEnd },
          ...branchContractFilter,
        },
        _sum: { amountDue: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: 'PAID',
          paidDate: { gte: thisMonthStart, lt: thisMonthEnd },
          ...branchContractFilter,
        },
        _sum: { amountPaid: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: {
          dueDate: { gte: prevMonthStart, lt: thisMonthStart },
          ...branchContractFilter,
        },
        _sum: { amountDue: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: 'PAID',
          paidDate: { gte: prevMonthStart, lt: thisMonthStart },
          ...branchContractFilter,
        },
        _sum: { amountPaid: true },
      }),
    ]);

    const currentDue = new Prisma.Decimal(thisMonthDue._sum.amountDue ?? 0);
    const currentCollectedAmount = new Prisma.Decimal(thisMonthCollected._sum.amountPaid ?? 0);
    const prevDue = new Prisma.Decimal(prevMonthDue._sum.amountDue ?? 0);
    const prevCollectedAmount = new Prisma.Decimal(prevMonthCollected._sum.amountPaid ?? 0);

    const currentRate = currentDue.gt(0)
      ? currentCollectedAmount.div(currentDue).mul(100).toDecimalPlaces(1).toNumber()
      : 0;
    const lastMonthRate = prevDue.gt(0)
      ? prevCollectedAmount.div(prevDue).mul(100).toDecimalPlaces(1).toNumber()
      : 0;
    const mom = Number((currentRate - lastMonthRate).toFixed(1));

    // ── Top delinquent customers ─────────────────────────────────────────────
    const branchSql = branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty;

    const topDelinquent = await this.prisma.$queryRaw<
      {
        customerId: string;
        customerName: string;
        totalOverdue: number;
        contractCount: number;
      }[]
    >(Prisma.sql`
      SELECT
        cu.id AS "customerId",
        cu.name AS "customerName",
        SUM(p.amount_due - p.amount_paid) AS "totalOverdue",
        COUNT(DISTINCT c.id) AS "contractCount"
      FROM customers cu
      JOIN contracts c ON c.customer_id = cu.id AND c.deleted_at IS NULL
      JOIN payments p ON p.contract_id = c.id
        AND p.status IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
        AND p.due_date < NOW()
      WHERE cu.deleted_at IS NULL
        ${branchSql}
      GROUP BY cu.id, cu.name
      ORDER BY SUM(p.amount_due - p.amount_paid) DESC
      LIMIT 10
    `);

    const topDelinquentMapped = topDelinquent.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      totalOverdue: new Prisma.Decimal(r.totalOverdue ?? 0).toNumber(),
      contractCount: Number(r.contractCount),
    }));

    // ── Channel effectiveness ────────────────────────────────────────────────
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const channelRows = await this.prisma.$queryRaw<
      {
        channel: string;
        totalSent: number;
        ledToPayment: number;
      }[]
    >(Prisma.sql`
      SELECT
        da.channel,
        COUNT(da.id) AS "totalSent",
        COUNT(p.id) FILTER (
          WHERE p.status = 'PAID'
            AND p.paid_date >= da.executed_at
            AND p.paid_date <= da.executed_at + INTERVAL '7 days'
        ) AS "ledToPayment"
      FROM dunning_actions da
      JOIN contracts c ON c.id = da.contract_id AND c.deleted_at IS NULL
      LEFT JOIN payments p ON p.contract_id = da.contract_id
      WHERE da.status IN ('SENT', 'DELIVERED')
        AND da.executed_at >= ${thirtyDaysAgo}
        AND da.deleted_at IS NULL
        ${branchSql}
      GROUP BY da.channel
      ORDER BY da.channel
    `);

    const channelEffectiveness = channelRows.map((r) => ({
      channel: r.channel,
      totalSent: Number(r.totalSent),
      ledToPayment: Number(r.ledToPayment),
    }));

    return {
      agingBuckets,
      collectionRate: {
        current: currentRate,
        lastMonth: lastMonthRate,
        mom,
      },
      collected: {
        thisMonth: currentCollectedAmount.toNumber(),
        count: thisMonthCollected._count || 0,
      },
      topDelinquent: topDelinquentMapped,
      channelEffectiveness,
    };
  }

  async computeWatchList(branchId?: string) {
    const branchFilter = branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      {
        customerId: string;
        customerName: string;
        customerPhone: string;
        contractId: string;
        contractNumber: string;
        latePaymentCount: number;
        partialPaymentCount: number;
        hadDunningReset: boolean;
        nextDueDate: Date | null;
        nextAmountDue: number | null;
      }[]
    >(Prisma.sql`
      SELECT
        cu.id AS "customerId",
        cu.name AS "customerName",
        cu.phone AS "customerPhone",
        c.id AS "contractId",
        c.contract_number AS "contractNumber",
        COUNT(p.id) FILTER (
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
        ) AS "latePaymentCount",
        COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') AS "partialPaymentCount",
        (c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE') AS "hadDunningReset",
        MIN(p2.due_date) AS "nextDueDate",
        MIN(p2.amount_due) AS "nextAmountDue"
      FROM customers cu
      JOIN contracts c ON c.customer_id = cu.id AND c.deleted_at IS NULL
      LEFT JOIN payments p ON p.contract_id = c.id
      LEFT JOIN payments p2 ON p2.contract_id = c.id AND p2.status IN ('PENDING', 'OVERDUE')
      WHERE cu.deleted_at IS NULL
        AND c.status = 'ACTIVE'
        ${branchFilter}
      GROUP BY cu.id, c.id
      HAVING
        COUNT(p.id) FILTER (
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
        ) >= 2
        OR COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') >= 1
        OR (c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE')
      ORDER BY
        (
          LEAST(COUNT(p.id) FILTER (
            WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
          ), 5)
          + COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') * 2
          + CASE WHEN c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE' THEN 3 ELSE 0 END
        ) DESC
      LIMIT 20
    `);

    const watchList = rows.map((r) => {
      const late = Number(r.latePaymentCount);
      const partial = Number(r.partialPaymentCount);
      const dunningReset = Boolean(r.hadDunningReset);
      const score = Math.min(late, 5) + partial * 2 + (dunningReset ? 3 : 0);
      const riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

      const reasons: string[] = [];
      if (late >= 2) reasons.push(`ชำระล่าช้า ${late} ครั้ง`);
      if (partial >= 1) reasons.push(`จ่ายไม่ครบ ${partial} ครั้ง`);
      if (dunningReset) reasons.push('เคยถูกติดตามหนี้แล้ว reset');

      return {
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        riskScore: score,
        riskLevel,
        reasons,
        nextDueDate: r.nextDueDate,
        nextAmountDue: r.nextAmountDue ? new Prisma.Decimal(r.nextAmountDue).toNumber() : null,
      };
    });

    const highCount = watchList.filter((w) => w.riskLevel === 'HIGH').length;
    const mediumCount = watchList.filter((w) => w.riskLevel === 'MEDIUM').length;

    return {
      total: watchList.length,
      highCount,
      mediumCount,
      watchList,
    };
  }
}
