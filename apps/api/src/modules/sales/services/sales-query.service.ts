import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadInstallmentConfig } from '../../../utils/config.util';

/**
 * Read-side of SalesService — pure queries with role-dependent response shaping
 * (costPrice stripping + OWNER-only totalProfit). Behavior-preserving extraction;
 * bodies are verbatim from the original SalesService.
 */
export class SalesQueryService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    saleType?: string;
    branchId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    paymentMethod?: string;
    salespersonId?: string;
    contractStatus?: string;
    page?: number;
    limit?: number;
    userRole?: string;
  }) {
    const { saleType, branchId, search, startDate, endDate, paymentMethod, salespersonId, contractStatus, page = 1, limit = 50, userRole } = filters;
    const where: Record<string, unknown> = { deletedAt: null };

    if (saleType) where.saleType = saleType;
    if (branchId) where.branchId = branchId;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (salespersonId) where.salespersonId = salespersonId;
    if (contractStatus) where.contract = { status: contractStatus };

    // Date range filter
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { financeCompany: { contains: search, mode: 'insensitive' } },
        { financeRefNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total, agg, groupBySaleType] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, costPrice: true } },
          branch: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          contract: { select: { id: true, contractNumber: true, status: true, monthlyPayment: true, totalMonths: true } },
        },
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where,
        _sum: { netAmount: true, discount: true },
      }),
      this.prisma.sale.groupBy({
        by: ['saleType'],
        where,
        _count: true,
        _sum: { netAmount: true },
      }),
    ]);

    // Build summary from aggregate + groupBy
    const getGroup = (type: string) => groupBySaleType.find(g => g.saleType === type);
    let totalProfit = 0;

    if (userRole === 'OWNER') {
      // Calculate profit from already-fetched data to avoid duplicate query
      totalProfit = data.reduce(
        (sum, s) => sum
          .add(new Prisma.Decimal(s.netAmount ?? 0))
          .sub(new Prisma.Decimal(s.product?.costPrice ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber();
    }

    const summary = {
      totalAmount: new Prisma.Decimal(agg._sum.netAmount ?? 0).toNumber(),
      totalDiscount: new Prisma.Decimal(agg._sum.discount ?? 0).toNumber(),
      totalProfit,
      cashCount: getGroup('CASH')?._count || 0,
      cashAmount: new Prisma.Decimal(getGroup('CASH')?._sum.netAmount ?? 0).toNumber(),
      installmentCount: getGroup('INSTALLMENT')?._count || 0,
      installmentAmount: new Prisma.Decimal(getGroup('INSTALLMENT')?._sum.netAmount ?? 0).toNumber(),
      financeCount: getGroup('EXTERNAL_FINANCE')?._count || 0,
      financeAmount: new Prisma.Decimal(getGroup('EXTERNAL_FINANCE')?._sum.netAmount ?? 0).toNumber(),
    };

    // Strip costPrice from response for non-OWNER roles
    const responseData = userRole === 'OWNER'
      ? data
      : data.map(s => {
          const { costPrice: _, ...productWithoutCost } = s.product;
          return { ...s, product: productWithoutCost };
        });

    return { data: responseData, total, page, limit, totalPages: Math.ceil(total / limit), summary };
  }

  async getSalespersons(user: { role: string; branchId?: string }) {
    const where: Record<string, unknown> = { isActive: true, deletedAt: null };
    if (user.role === 'BRANCH_MANAGER' && user.branchId) {
      where.branchId = user.branchId;
    }
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true, nationalId: true } },
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, costPrice: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        contract: true,
      },
    });
    if (!sale || sale.deletedAt) throw new NotFoundException('ไม่พบใบขาย');
    return sale;
  }

  async getPosConfig() {
    return loadInstallmentConfig(this.prisma);
  }

  async getTopSellingProducts(limit = 6) {
    const results = await this.prisma.sale.groupBy({
      by: ['productId'],
      where: { deletedAt: null },
      _count: { productId: true },
      orderBy: { _count: { productId: 'desc' } },
      take: limit,
    });

    if (results.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: results.map(r => r.productId) }, deletedAt: null },
      select: { id: true, name: true, brand: true, model: true },
    });

    const productMap = new Map(products.map(p => [p.id, p]));
    return results
      .map(r => {
        const p = productMap.get(r.productId);
        return p ? { ...p, count: r._count.productId } : null;
      })
      .filter(Boolean);
  }

  async getDailySummary(date: string, branchId?: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const where: Record<string, unknown> = {
      createdAt: { gte: startOfDay, lte: endOfDay },
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;

    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        product: { select: { name: true, brand: true, model: true } },
        salesperson: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const summary = {
      totalSales: sales.length,
      cashSales: sales.filter(s => s.saleType === 'CASH').length,
      installmentSales: sales.filter(s => s.saleType === 'INSTALLMENT').length,
      externalFinanceSales: sales.filter(s => s.saleType === 'EXTERNAL_FINANCE').length,
      totalRevenue: sales.reduce(
        (sum, s) => sum.add(new Prisma.Decimal(s.netAmount ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
      sales,
    };

    return summary;
  }
}
