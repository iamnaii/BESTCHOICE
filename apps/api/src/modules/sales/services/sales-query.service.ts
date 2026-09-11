import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadInstallmentConfig } from '../../../utils/config.util';
import type { SalesReadActor, SalesReadFilters } from '../sales-read.types';
import { projectSaleForActor, salesBranchWhere } from './sales-read-policy';

const CONTRACT_SALE_SELECT = {
  id: true, contractNumber: true, status: true, monthlyPayment: true, totalMonths: true,
} satisfies Prisma.ContractSelect;

const completedSaleWhere: Prisma.SaleWhereInput = {
  OR: [{ contractId: null }, { contract: { is: { status: { not: 'DRAFT' }, deletedAt: null } } }],
};

/**
 * Read-side of SalesService — pure queries with role-dependent response shaping
 * All reads are actor-scoped, including detail, summaries and POS suggestions.
 */
export class SalesQueryService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: SalesReadFilters, actor: SalesReadActor) {
    const { saleType, branchId, search, startDate, endDate, paymentMethod, salespersonId, contractStatus, includeVoided, page = 1, limit = 50 } = filters;
    const where: Record<string, unknown> = { ...salesBranchWhere(actor, branchId) };
    // ใบที่ยกเลิก (void = soft delete) ถูกซ่อนจากรายการ+ยอดสรุปโดย default —
    // ส่ง includeVoided=true (opt-out เฉพาะหน้ารายการ) เพื่อเห็นทั้งหมด.
    // ทุก query ในเมธอดนี้ (findMany/count/aggregate/groupBy) ใช้ `where` ก้อนเดียวกัน
    // จึงคุมที่จุดสร้างจุดเดียว. รายงานอื่น (getDailySummary / getTopSellingProducts)
    // ไม่มี opt-out โดยเจตนา — รายงานต้องไม่นับใบที่ยกเลิก.
    if (!includeVoided) where.deletedAt = null;

    if (saleType) where.saleType = saleType;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (salespersonId) where.salespersonId = salespersonId;
    if (contractStatus) where.contract = { status: contractStatus };
    else where.AND = [completedSaleWhere];

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
          contract: { select: CONTRACT_SALE_SELECT },
          // ชื่อผู้ยกเลิก — หน้ารายการแสดงบนแถวที่ถูกยกเลิกเมื่อเปิด includeVoided
          // (deletedAt / voidReason เป็น scalar มากับ include อยู่แล้ว)
          voidedBy: { select: { id: true, name: true } },
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

    if (actor.role === 'OWNER') {
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

    const responseData = data.map(sale => projectSaleForActor(sale, actor));

    return { data: responseData, total, page, limit, totalPages: Math.ceil(total / limit), summary };
  }

  async getSalespersons(actor: SalesReadActor) {
    const where = { isActive: true, deletedAt: null, ...salesBranchWhere(actor) };
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * เปิดดูใบขายรายใบ — **ใบที่ยกเลิกแล้ว (void = soft delete) เปิดดูได้**
   * พร้อมฟิลด์การยกเลิก (`deletedAt` / `voidReason` / `voidedBy`) ให้หน้าจอแสดง.
   *
   * เดิมเมธอดนี้ throw NotFound เมื่อ `sale.deletedAt` ⇒ เปิดดูใบที่ยกเลิกไม่ได้เลย.
   * เปลี่ยนพฤติกรรมได้อย่างปลอดภัยเพราะผู้เรียกมีทางเดียว: `GET /sales/:id`
   * (ผ่าน facade `SalesService.findOne`) — ไม่มี service อื่นพึ่ง NotFoundException
   * ของใบที่ถูกลบ (ตรวจ 2026-08-23; `SaleVoidService` อ่าน Sale ตรงจาก tx เอง).
   * ผู้เรียกใหม่ที่ต้องการ "ใบที่ยังไม่ยกเลิกเท่านั้น" ต้องเช็ค `deletedAt` เอง.
   */
  async findOne(id: string, actor: SalesReadActor) {
    const sale = await this.prisma.sale.findFirst({
      where: { AND: [{ id }, salesBranchWhere(actor)] },
      include: {
        customer: { select: { id: true, name: true, phone: true, nationalId: true } },
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, costPrice: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
        // Contract snapshots include private customer data; follow the contract
        // link through its own authorized endpoint for anything beyond this summary.
        contract: { select: CONTRACT_SALE_SELECT },
      },
    });
    if (!sale) throw new NotFoundException('ไม่พบใบขาย');
    return projectSaleForActor(sale, actor);
  }

  async getPosConfig() {
    return loadInstallmentConfig(this.prisma);
  }

  async getTopSellingProducts(actor: SalesReadActor, limit = 6) {
    const results = await this.prisma.sale.groupBy({
      by: ['productId'],
      where: { deletedAt: null, ...salesBranchWhere(actor), AND: [completedSaleWhere] },
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

  async getDailySummary(date: string, actor: SalesReadActor, branchId?: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const where: Record<string, unknown> = {
      createdAt: { gte: startOfDay, lte: endOfDay },
      AND: [completedSaleWhere],
      deletedAt: null,
      ...salesBranchWhere(actor, branchId),
    };

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
