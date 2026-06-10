import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Operational-domain read reports extracted from ReportsService
 * (branch comparison, stock, contract export).
 *
 * Plain class (NOT @Injectable / NOT DI-registered) — internally constructed by
 * the ReportsService facade so the facade's 2-arg ctor + every `new
 * ReportsService(...)` spec site stay untouched. Pure-read over prisma.
 */
export class OperationalReportService {
  constructor(private prisma: PrismaService) {}

  /**
   * Branch comparison report
   */
  async getBranchComparisonReport(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    const branchIds = branches.map((b) => b.id);

    // Batch: one query per metric for all branches (5 queries total instead of 5 * N)
    const [newByBranch, activeByBranch, overdueByBranch, paymentsByBranch, productsByBranch] = await Promise.all([
      this.prisma.contract.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, createdAt: { gte: start, lte: end }, deletedAt: null },
        _count: true,
      }),
      this.prisma.contract.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, status: 'ACTIVE', deletedAt: null },
        _count: true,
      }),
      this.prisma.contract.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['contractId'],
        where: { paidDate: { gte: start, lte: end }, status: 'PAID', contract: { branchId: { in: branchIds } } },
        _sum: { amountPaid: true },
      }).then(async (groups) => {
        // We need branchId from the contract, so fetch a lightweight mapping
        if (groups.length === 0) return new Map<string, number>();
        const contractIds = groups.map((g) => g.contractId);
        const contracts = await this.prisma.contract.findMany({
          where: { id: { in: contractIds } },
          select: { id: true, branchId: true },
        });
        const contractBranchMap = new Map(contracts.map((c) => [c.id, c.branchId]));
        const result = new Map<string, number>();
        for (const g of groups) {
          const bid = contractBranchMap.get(g.contractId);
          if (bid) result.set(
            bid,
            new Prisma.Decimal(result.get(bid) ?? 0)
              .add(new Prisma.Decimal(g._sum.amountPaid ?? 0))
              .toNumber(),
          );
        }
        return result;
      }),
      this.prisma.product.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, status: 'IN_STOCK', deletedAt: null },
        _count: true,
      }),
    ]);

    // Build lookup maps
    const newMap = new Map(newByBranch.map((g) => [g.branchId, g._count]));
    const activeMap = new Map(activeByBranch.map((g) => [g.branchId, g._count]));
    const overdueMap = new Map(overdueByBranch.map((g) => [g.branchId, g._count]));
    const productsMap = new Map(productsByBranch.map((g) => [g.branchId, g._count]));

    return branches.map((branch) => ({
      branchId: branch.id,
      branchName: branch.name,
      newContracts: newMap.get(branch.id) || 0,
      activeContracts: activeMap.get(branch.id) || 0,
      overdueContracts: overdueMap.get(branch.id) || 0,
      paymentsReceived: paymentsByBranch.get(branch.id) || 0,
      inStockProducts: productsMap.get(branch.id) || 0,
    }));
  }

  /**
   * Stock report
   */
  async getStockReport(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};

    const products = await this.prisma.product.groupBy({
      by: ['status', 'branchId'],
      where: { deletedAt: null, ...branchFilter },
      _count: true,
    });

    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    const branchMap = new Map(branches.map((b) => [b.id, b.name]));

    const stockValue = await this.prisma.product.aggregate({
      where: { status: 'IN_STOCK', deletedAt: null, ...branchFilter },
      _sum: { costPrice: true },
      _count: true,
    });

    return {
      byStatusAndBranch: products.map((p) => ({
        status: p.status,
        branch: branchMap.get(p.branchId) || p.branchId,
        count: p._count,
      })),
      totalInStock: stockValue._count || 0,
      totalStockValue: new Prisma.Decimal(stockValue._sum.costPrice ?? 0).toNumber(),
    };
  }

  /**
   * Export data as CSV-ready format
   */
  async exportContracts(filters: { status?: string; branchId?: string; startDate?: string; endDate?: string }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Record<string, unknown>).lte = end;
      }
    }

    const contracts = await this.prisma.contract.findMany({
      where,
      include: {
        customer: { select: { name: true, phone: true } },
        product: { select: { name: true, brand: true, model: true, imeiSerial: true } },
        branch: { select: { name: true } },
        salesperson: { select: { name: true } },
        payments: { select: { installmentNo: true, amountDue: true, amountPaid: true, status: true, dueDate: true, paidDate: true, lateFee: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    return contracts.map((c) => ({
      contractNumber: c.contractNumber,
      status: c.status,
      customerName: c.customer.name,
      customerPhone: c.customer.phone,
      productName: `${c.product.brand} ${c.product.model}`,
      imei: c.product.imeiSerial,
      branch: c.branch.name,
      salesperson: c.salesperson.name,
      sellingPrice: new Prisma.Decimal(c.sellingPrice ?? 0).toNumber(),
      downPayment: new Prisma.Decimal(c.downPayment ?? 0).toNumber(),
      interestRate: new Prisma.Decimal(c.interestRate ?? 0).toNumber(),
      totalMonths: c.totalMonths,
      monthlyPayment: new Prisma.Decimal(c.monthlyPayment ?? 0).toNumber(),
      financedAmount: new Prisma.Decimal(c.financedAmount ?? 0).toNumber(),
      interestTotal: new Prisma.Decimal(c.interestTotal ?? 0).toNumber(),
      paidInstallments: c.payments.filter((p) => p.status === 'PAID').length,
      totalPaid: c.payments.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountPaid ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
      totalLateFees: c.payments.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.lateFee ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
      createdAt: c.createdAt,
    }));
  }
}
