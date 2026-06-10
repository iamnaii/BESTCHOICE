import { Prisma, ContractStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { calculateDaysOverdue, calculateDaysElapsed } from '../../../utils/date.util';

/**
 * Receivables-domain read reports extracted from ReportsService.
 *
 * Plain class (NOT @Injectable / NOT DI-registered) — internally constructed by
 * the ReportsService facade so the facade's 2-arg ctor + every `new
 * ReportsService(...)` spec site stay untouched. Pure-read over prisma.
 *
 * NOTE: aging-bucket labels intentionally differ between getAgingReport
 * (1-30/31-60/61-90/90+) and getFinancePortfolio (current/1to30/31to60/61to90/over90).
 * Both moved VERBATIM — DO NOT unify labels.
 */
export class ReceivablesReportService {
  constructor(private prisma: PrismaService) {}

  /**
   * Aging Report: group receivables by age buckets (1-30, 31-60, 61-90, 90+)
   */
  async getAgingReport(branchId?: string) {
    const now = new Date();
    const branchFilter = branchId ? { contract: { branchId, deletedAt: null } } : { contract: { deletedAt: null } };

    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        dueDate: { lt: now },
        ...branchFilter,
      },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true, phone: true } },
            branch: { select: { name: true } },
          },
        },
      },
    });

    const buckets = { '1-30': [] as typeof overduePayments, '31-60': [] as typeof overduePayments, '61-90': [] as typeof overduePayments, '90+': [] as typeof overduePayments };

    for (const p of overduePayments) {
      const days = calculateDaysElapsed(p.dueDate, now);
      if (days <= 30) buckets['1-30'].push(p);
      else if (days <= 60) buckets['31-60'].push(p);
      else if (days <= 90) buckets['61-90'].push(p);
      else buckets['90+'].push(p);
    }

    const summarize = (items: typeof overduePayments) => ({
      count: items.length,
      totalOutstanding: items.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountDue ?? 0)).sub(new Prisma.Decimal(p.amountPaid ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
      totalLateFees: items.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.lateFee ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
    });

    return {
      '1-30': summarize(buckets['1-30']),
      '31-60': summarize(buckets['31-60']),
      '61-90': summarize(buckets['61-90']),
      '90+': summarize(buckets['90+']),
      total: summarize(overduePayments),
    };
  }

  /**
   * High-risk customers report
   */
  async getHighRiskCustomers(branchId?: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const branchFilter = branchId ? { branchId } : {};
    const where = { status: { in: ['OVERDUE' as const, 'DEFAULT' as const] }, deletedAt: null, ...branchFilter };

    const [customers, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true, lineIdFinance: true, lineIdShop: true } },
          branch: { select: { name: true } },
          payments: {
            where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
            select: { amountDue: true, amountPaid: true, lateFee: true, dueDate: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    const data = customers.map((c) => {
      const totalOutstanding = c.payments.reduce(
        (sum, p) => sum
          .add(new Prisma.Decimal(p.amountDue ?? 0))
          .sub(new Prisma.Decimal(p.amountPaid ?? 0))
          .add(new Prisma.Decimal(p.lateFee ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber();
      const oldestDue = c.payments.reduce(
        (oldest, p) => (new Date(p.dueDate) < oldest ? new Date(p.dueDate) : oldest),
        new Date(),
      );
      return {
        contractNumber: c.contractNumber,
        status: c.status,
        customer: c.customer,
        branch: c.branch.name,
        overdueInstallments: c.payments.length,
        totalOutstanding,
        daysOverdue: calculateDaysOverdue(oldestDue),
      };
    });

    return { data, total, page, limit: safeLimit };
  }

  /**
   * FINANCE Portfolio: all contracts owned by BESTCHOICE FINANCE
   * Returns per-contract receivable calculations + portfolio summary + aging.
   */
  async getFinancePortfolio(
    status?: string,
    page = 1,
    limit = 50,
    startDate?: string,
    endDate?: string,
  ) {
    const safeLimit = Math.min(limit, 100);

    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!financeCompany) {
      return {
        data: [],
        summary: { totalContracts: 0, totalReceivable: 0, totalCollected: 0, totalOutstanding: 0, collectionRate: 0 },
        aging: {
          current: { count: 0, amount: 0 },
          days1to30: { count: 0, amount: 0 },
          days31to60: { count: 0, amount: 0 },
          days61to90: { count: 0, amount: 0 },
          over90: { count: 0, amount: 0 },
        },
        total: 0,
        page,
        limit: safeLimit,
      };
    }

    const defaultStatuses = [
      ContractStatus.ACTIVE,
      ContractStatus.OVERDUE,
      ContractStatus.DEFAULT,
      ContractStatus.COMPLETED,
      ContractStatus.EARLY_PAYOFF,
      ContractStatus.EXCHANGED,
    ] as const;

    const statusFilter =
      status && status !== 'ALL' && Object.values(ContractStatus).includes(status as ContractStatus)
        ? [status as ContractStatus]
        : [...defaultStatuses];

    // Date range filters Contract.createdAt — empty string = no filter (open-ended)
    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      const d = new Date(`${startDate}T00:00:00`);
      if (!isNaN(d.getTime())) createdAtFilter.gte = d;
    }
    if (endDate) {
      const d = new Date(`${endDate}T23:59:59.999`);
      if (!isNaN(d.getTime())) createdAtFilter.lte = d;
    }

    const where = {
      deletedAt: null,
      status: { in: statusFilter },
      product: { ownedByCompanyId: financeCompany.id, deletedAt: null },
      ...(createdAtFilter.gte || createdAtFilter.lte ? { createdAt: createdAtFilter } : {}),
    };

    const [contracts, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { brand: true, model: true, imeiSerial: true } },
          branch: { select: { name: true } },
          payments: {
            where: { deletedAt: null },
            select: {
              id: true,
              installmentNo: true,
              amountDue: true,
              amountPaid: true,
              lateFee: true,
              dueDate: true,
              status: true,
            },
            orderBy: { installmentNo: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    const now = new Date();

    const data = contracts.map((c) => {
      const totalReceivable = c.payments.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountDue ?? 0)),
        new Prisma.Decimal(0),
      );
      const totalPaid = c.payments.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountPaid ?? 0)),
        new Prisma.Decimal(0),
      );
      const outstanding = totalReceivable.sub(totalPaid);
      const paidInstallments = c.payments.filter((p) => p.status === 'PAID').length;
      const remainingInstallments = c.totalMonths - paidInstallments;

      const pendingPayments = c.payments
        .filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE' || p.status === 'PARTIALLY_PAID')
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      const nextDueDate = pendingPayments.length > 0 ? pendingPayments[0].dueDate : null;

      return {
        id: c.id,
        contractNumber: c.contractNumber,
        status: c.status,
        customer: c.customer,
        product: c.product,
        branch: c.branch.name,
        sellingPrice: new Prisma.Decimal(c.sellingPrice ?? 0).toNumber(),
        financedAmount: new Prisma.Decimal(c.financedAmount ?? 0).toNumber(),
        monthlyPayment: new Prisma.Decimal(c.monthlyPayment ?? 0).toNumber(),
        totalMonths: c.totalMonths,
        paidInstallments,
        remainingInstallments,
        totalReceivable: totalReceivable.toNumber(),
        totalPaid: totalPaid.toNumber(),
        outstanding: outstanding.toNumber(),
        nextDueDate,
        createdAt: c.createdAt,
      };
    });

    // Summary and aging computed over ALL matching contracts (not just current page)
    const allContracts = await this.prisma.contract.findMany({
      where,
      include: {
        payments: {
          where: { deletedAt: null },
          select: { amountDue: true, amountPaid: true, dueDate: true, status: true },
        },
      },
    });

    let sumReceivable = new Prisma.Decimal(0);
    let sumCollected = new Prisma.Decimal(0);

    const aging = {
      current: { count: 0, amount: new Prisma.Decimal(0) },
      days1to30: { count: 0, amount: new Prisma.Decimal(0) },
      days31to60: { count: 0, amount: new Prisma.Decimal(0) },
      days61to90: { count: 0, amount: new Prisma.Decimal(0) },
      over90: { count: 0, amount: new Prisma.Decimal(0) },
    };

    for (const c of allContracts) {
      for (const p of c.payments) {
        const due = new Prisma.Decimal(p.amountDue ?? 0);
        const paid = new Prisma.Decimal(p.amountPaid ?? 0);
        sumReceivable = sumReceivable.add(due);
        sumCollected = sumCollected.add(paid);
        const pOutstanding = due.sub(paid);

        if (p.status === 'PAID') continue;

        const dueDate = new Date(p.dueDate);
        const diffDays = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays <= 0) {
          aging.current.count++;
          aging.current.amount = aging.current.amount.add(pOutstanding);
        } else if (diffDays <= 30) {
          aging.days1to30.count++;
          aging.days1to30.amount = aging.days1to30.amount.add(pOutstanding);
        } else if (diffDays <= 60) {
          aging.days31to60.count++;
          aging.days31to60.amount = aging.days31to60.amount.add(pOutstanding);
        } else if (diffDays <= 90) {
          aging.days61to90.count++;
          aging.days61to90.amount = aging.days61to90.amount.add(pOutstanding);
        } else {
          aging.over90.count++;
          aging.over90.amount = aging.over90.amount.add(pOutstanding);
        }
      }
    }

    const sumReceivableNum = sumReceivable.toNumber();
    const sumCollectedNum = sumCollected.toNumber();

    return {
      data,
      summary: {
        totalContracts: allContracts.length,
        totalReceivable: sumReceivableNum,
        totalCollected: sumCollectedNum,
        totalOutstanding: new Prisma.Decimal(sumReceivableNum).sub(new Prisma.Decimal(sumCollectedNum)).toNumber(),
        collectionRate: sumReceivableNum > 0
          ? Math.round((sumCollectedNum / sumReceivableNum) * 10000) / 100
          : 0,
      },
      aging: {
        current: { count: aging.current.count, amount: aging.current.amount.toNumber() },
        days1to30: { count: aging.days1to30.count, amount: aging.days1to30.amount.toNumber() },
        days31to60: { count: aging.days31to60.count, amount: aging.days31to60.amount.toNumber() },
        days61to90: { count: aging.days61to90.count, amount: aging.days61to90.amount.toNumber() },
        over90: { count: aging.over90.count, amount: aging.over90.amount.toNumber() },
      },
      total,
      page,
      limit: safeLimit,
    };
  }
}
