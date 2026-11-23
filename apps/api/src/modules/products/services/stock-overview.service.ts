import type { StockSalesActor } from './stock-sales-analytics.service';
import { StockSalesAnalyticsService, stockAnalyticsWindow } from './stock-sales-analytics.service';
import type { StockInventoryScope } from '@installment/shared';
import { stockInventoryWhere } from '../stock-inventory-filter';
import { domainAccessClient } from '../../employee-access/access-execution-context';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { bkkYearMonth, calculateDaysElapsed } from '../../../utils/date.util';

@Injectable()
export class StockOverviewService {
  private get prisma(): PrismaService { return domainAccessClient(this.basePrisma); }
  constructor(private readonly basePrisma: PrismaService) {}

  // === Stock Overview ===

  async getStock(filters: {
    inventoryScope?: StockInventoryScope;
    search?: string;
    branchId?: string;
    status?: string;
    category?: string;
    brand?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null, AND: [stockInventoryWhere(filters.inventoryScope)] };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = filters.brand;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
        { imeiSerial: { contains: filters.search } },
      ];
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          prices: { where: { isDefault: true, deletedAt: null }, take: 1 },
        },
        orderBy: [{ branch: { name: 'asc' } }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    // Aggregate summary by branch (from DB, not from paginated results)
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const summaryWhere: Record<string, unknown> = { deletedAt: null, AND: [stockInventoryWhere(filters.inventoryScope)] };
    if (filters.branchId) summaryWhere.branchId = filters.branchId;
    if (filters.category) summaryWhere.category = filters.category;
    if (filters.brand) summaryWhere.brand = filters.brand;

    const summaryData = await this.prisma.product.groupBy({
      by: ['branchId', 'status'],
      where: summaryWhere as Prisma.ProductWhereInput,
      _count: true,
      _sum: { costPrice: true },
    });

    const summary = branches.map((branch) => {
      const branchRows = summaryData.filter((r) => r.branchId === branch.id);
      const totalCount = branchRows.reduce((sum, r) => sum + r._count, 0);
      const inStockRow = branchRows.find((r) => r.status === 'IN_STOCK');
      const inStock = inStockRow?._count || 0;
      const totalValue = new Prisma.Decimal(inStockRow?._sum?.costPrice ?? 0).toNumber();
      return { branch, total: totalCount, inStock, totalValue };
    });

    return { products, total, page, limit, totalPages: Math.ceil(total / limit), summary };
  }

  // === Stock Dashboard ===

  async getStockDashboard(branchId?: string, inventoryScope: StockInventoryScope = 'all', actor?: StockSalesActor) {
    const branchFilter = { ...(branchId ? { branchId } : {}), AND: [stockInventoryWhere(inventoryScope)] };
    const baseWhere = { deletedAt: null, ...branchFilter };
    const now = new Date();

    // --- Parallel batch queries ---
    const [
      allProducts,
      pendingTransfers,
      newProducts,
    ] = await Promise.all([
      // All active products (for aging, breakdowns, condition grade, margin)
      this.prisma.product.findMany({
        where: baseWhere as Prisma.ProductWhereInput,
        select: {
          id: true, status: true, category: true, brand: true, model: true,
          color: true, storage: true, costPrice: true,
          createdAt: true, stockInDate: true,
          prices: { where: { isDefault: true, deletedAt: null }, take: 1, select: { amount: true } },
        },
      }),
      // Pending transfers count
      this.prisma.stockTransfer.count({
        where: { status: 'PENDING', deletedAt: null, product: { deletedAt: null, ...stockInventoryWhere(inventoryScope) }, ...(branchId ? { toBranchId: branchId } : {}) },
      }),
      // Products created in last 6 months (stock in — includes soft-deleted to track total received volume)
      this.prisma.product.findMany({
        where: {
          createdAt: { gte: stockAnalyticsWindow(now).start },
          ...branchFilter,
        },
        select: { createdAt: true },
      }),
    ]);

    // --- 1. Stock Aging (only IN_STOCK products) ---
    const inStockProducts = allProducts.filter((p) => p.status === 'IN_STOCK');
    const agingBuckets = [
      { label: '0-30 วัน', min: 0, max: 30, count: 0, value: 0 },
      { label: '31-60 วัน', min: 31, max: 60, count: 0, value: 0 },
      { label: '61-90 วัน', min: 61, max: 90, count: 0, value: 0 },
      { label: '90+ วัน', min: 91, max: Infinity, count: 0, value: 0 },
    ];
    for (const p of inStockProducts) {
      const refDate = p.stockInDate ? new Date(p.stockInDate) : new Date(p.createdAt);
      const days = calculateDaysElapsed(refDate, now);
      const bucket = agingBuckets.find((b) => days >= b.min && days <= b.max);
      if (bucket) {
        bucket.count++;
        bucket.value += Number(p.costPrice);
      }
    }

    // --- 2. Action Required ---
    const actionRequired = {
      inspection: allProducts.filter((p) => p.status === 'INSPECTION').length,
      qcPending: allProducts.filter((p) => p.status === 'QC_PENDING').length,
      photoPending: allProducts.filter((p) => p.status === 'PHOTO_PENDING').length,
      pendingTransfers,
      repossessed: allProducts.filter((p) => p.status === 'REPOSSESSED').length,
      agingOver90: agingBuckets[3].count,
    };

    // --- 3. Value by Status ---
    const statusMap = new Map<string, { count: number; value: number }>();
    for (const p of allProducts) {
      const entry = statusMap.get(p.status) || { count: 0, value: 0 };
      entry.count++;
      entry.value += Number(p.costPrice);
      statusMap.set(p.status, entry);
    }
    const valueByStatus = Array.from(statusMap.entries())
      .map(([status, data]) => ({ status, ...data }))
      .sort((a, b) => b.value - a.value);

    // --- 4. Category + Brand + Color + Storage Breakdown (only IN_STOCK) ---
    const groupBy = (items: typeof inStockProducts, key: 'category' | 'brand' | 'color' | 'storage') => {
      const map = new Map<string, { count: number; value: number }>();
      for (const p of items) {
        const val = p[key] || 'ไม่ระบุ';
        const entry = map.get(val) || { count: 0, value: 0 };
        entry.count++;
        entry.value += Number(p.costPrice);
        map.set(val, entry);
      }
      return Array.from(map.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.count - a.count);
    };

    const byCategory = groupBy(inStockProducts, 'category');
    const byBrand = groupBy(inStockProducts, 'brand');
    const byColor = groupBy(inStockProducts, 'color');
    const byStorage = groupBy(inStockProducts, 'storage');

    // Use actual native/imported sale occurrences for every sales metric.
    const salesAnalytics = await new StockSalesAnalyticsService(this.basePrisma).read(branchId, inventoryScope, now, actor);
    const stockMovement = salesAnalytics.monthly.map(month => ({
      month: month.key,
      in: newProducts.filter(p => bkkYearMonth(p.createdAt) === month.key).length,
      out: month.count,
    }));
    const soldThisMonth = salesAnalytics.current.count;
    const soldLastMonth = salesAnalytics.previous.count;

    // Average days in stock (from stockInDate or createdAt as fallback)
    const totalDays = inStockProducts.reduce((sum, p) => {
      const refDate = p.stockInDate ? new Date(p.stockInDate) : new Date(p.createdAt);
      return sum + calculateDaysElapsed(refDate, now);
    }, 0);
    const avgDaysInStock = inStockProducts.length > 0 ? Math.round(totalDays / inStockProducts.length) : 0;

    const topSellers = salesAnalytics.topSellers;

    // --- 9. Slow Movers (IN_STOCK products with longest days) ---
    const slowMovers = inStockProducts
      .map((p) => ({
        name: `${p.brand} ${p.model}`,
        days: calculateDaysElapsed(new Date(p.stockInDate || p.createdAt), now),
        costPrice: Number(p.costPrice),
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);

    // --- 10. Margin Overview (IN_STOCK products with default selling price) ---
    const marginItems = inStockProducts
      .filter((p) => p.prices.length > 0 && Number(p.prices[0].amount) > 0)
      .map((p) => {
        const cost = Number(p.costPrice);
        const sell = Number(p.prices[0].amount);
        return { cost, sell, margin: sell - cost };
      });

    const totalCost = marginItems.reduce((s, m) => s + m.cost, 0);
    const totalSell = marginItems.reduce((s, m) => s + m.sell, 0);
    const totalMargin = marginItems.reduce((s, m) => s + m.margin, 0);
    const avgMarginPct = totalCost > 0 ? Math.round((totalMargin / totalCost) * 100) : null;

    const marginOverview = {
      totalCost,
      totalSell,
      totalMargin,
      avgMarginPct,
      avgMarginPerUnit: marginItems.length > 0 ? Math.round(totalMargin / marginItems.length) : 0,
      itemsWithPrice: marginItems.length,
    };

    return {
      stockAging: agingBuckets,
      actionRequired,
      valueByStatus,
      byCategory,
      byBrand,
      byColor,
      byStorage,
      stockMovement,
      salesAnalytics,
      stockTurnover: {
        avgDaysInStock,
        soldThisMonth,
        soldLastMonth,
        currentStock: inStockProducts.length,
      },
      topSellers,
      slowMovers,
      marginOverview,
    };
  }

  // === Warranty Alerts ===

  /**
   * Get products with warranty expiring soon
   */
  async getWarrantyExpiring(daysAhead: number = 30, branchId?: string, inventoryScope: StockInventoryScope = 'all') {
    const now = new Date();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysAhead);

    const where: Record<string, unknown> = {
      deletedAt: null,
      AND: [stockInventoryWhere(inventoryScope)],
      warrantyExpired: false,
      warrantyExpireDate: { gte: now, lte: deadline },
      status: { in: ['IN_STOCK', 'RESERVED'] },
    };
    if (branchId) where.branchId = branchId;

    const products = await this.prisma.product.findMany({
      where: where as Prisma.ProductWhereInput,
      include: {
        branch: { select: { id: true, name: true } },
        prices: { where: { isDefault: true, deletedAt: null }, take: 1 },
      },
      orderBy: { warrantyExpireDate: 'asc' },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      model: p.model,
      imeiSerial: p.imeiSerial,
      branch: p.branch,
      warrantyExpireDate: p.warrantyExpireDate,
      daysRemaining: Math.ceil(
        (new Date(p.warrantyExpireDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      ),
      sellingPrice: p.prices[0] ? Number(p.prices[0].amount) : null,
    }));
  }

  // === Supplier Performance ===

  /**
   * Get supplier performance metrics (rejection rate, delivery on-time, etc.)
   */
  async getSupplierPerformance() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });

    const results: {
      supplier: { id: string; name: string };
      poCount: number;
      totalOrdered: number;
      totalReceived: number;
      fulfillmentRate: number;
      totalPassed: number;
      totalRejected: number;
      qualityRate: number;
      onTimeRate: number;
      deliveredCount: number;
    }[] = [];

    for (const supplier of suppliers) {
      // Get all POs for this supplier
      const pos = await this.prisma.purchaseOrder.findMany({
        where: { supplierId: supplier.id, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        select: {
          id: true, status: true, orderDate: true, expectedDate: true,
          items: { select: { quantity: true, receivedQty: true } },
          goodsReceivings: {
            select: {
              createdAt: true,
              items: { select: { status: true } },
            },
          },
        },
      });

      if (pos.length === 0) continue;

      let totalOrdered = 0;
      let totalReceived = 0;
      let totalPassed = 0;
      let totalRejected = 0;
      let onTimeCount = 0;
      let deliveredCount = 0;

      for (const po of pos) {
        totalOrdered += po.items.reduce((sum, i) => sum + i.quantity, 0);
        totalReceived += po.items.reduce((sum, i) => sum + i.receivedQty, 0);

        for (const gr of po.goodsReceivings) {
          for (const item of gr.items) {
            if (item.status === 'PASS') totalPassed++;
            if (item.status === 'REJECT') totalRejected++;
          }

          // Check if delivered on time
          if (po.expectedDate) {
            deliveredCount++;
            if (new Date(gr.createdAt) <= new Date(po.expectedDate)) {
              onTimeCount++;
            }
          }
        }
      }

      const totalInspected = totalPassed + totalRejected;
      results.push({
        supplier,
        poCount: pos.length,
        totalOrdered,
        totalReceived,
        fulfillmentRate: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0,
        totalPassed,
        totalRejected,
        qualityRate: totalInspected > 0 ? Math.round((totalPassed / totalInspected) * 100) : 100,
        onTimeRate: deliveredCount > 0 ? Math.round((onTimeCount / deliveredCount) * 100) : 0,
        deliveredCount,
      });
    }

    return results.sort((a, b) => b.poCount - a.poCount);
  }
}
