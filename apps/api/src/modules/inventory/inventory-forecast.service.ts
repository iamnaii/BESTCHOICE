import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductCategory } from '@prisma/client';

export interface CategoryForecast {
  category: string;
  currentStock: number;
  salesLast30d: number;
  salesLast60d: number;
  salesLast90d: number;
  weeklyRate: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  daysOfStock: number;
  stockHealth: 'OK' | 'LOW';
  suggestedReorder: number;
}

export interface SlowMovingProduct {
  id: string;
  name: string;
  brand: string;
  daysInStock: number;
  category: string;
}

@Injectable()
export class InventoryForecastService {
  constructor(private prisma: PrismaService) {}

  async getInventoryForecast(branchId?: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const branchFilter = branchId ? { branchId } : {};
    const productBranchFilter = branchId ? { branchId } : {};

    // Batch queries: stock counts + sales counts per category + slow-moving products
    const [stockByCategory, sales90d, slowMovingProducts] = await Promise.all([
      // Current stock grouped by category
      this.prisma.product.groupBy({
        by: ['category'],
        where: {
          status: 'IN_STOCK',
          deletedAt: null,
          ...productBranchFilter,
        },
        _count: true,
      }),

      // All sales in last 90 days with product category and sale date
      this.prisma.sale.findMany({
        where: {
          createdAt: { gte: ninetyDaysAgo },
          deletedAt: null,
          ...branchFilter,
        },
        select: {
          createdAt: true,
          product: { select: { category: true } },
        },
      }),

      // Products in stock > 60 days with no sales
      this.getSlowMovingProducts(sixtyDaysAgo, productBranchFilter),
    ]);

    // Build stock map by category
    const stockMap = new Map<string, number>();
    for (const group of stockByCategory) {
      stockMap.set(group.category, group._count);
    }

    // Count sales per category per time window
    const salesCountMap = new Map<string, { last30: number; last60: number; last90: number }>();
    for (const sale of sales90d) {
      const cat = sale.product.category;
      const entry = salesCountMap.get(cat) || { last30: 0, last60: 0, last90: 0 };

      entry.last90++;
      if (sale.createdAt >= sixtyDaysAgo) entry.last60++;
      if (sale.createdAt >= thirtyDaysAgo) entry.last30++;

      salesCountMap.set(cat, entry);
    }

    // Build forecast for each category
    const allCategories: ProductCategory[] = ['PHONE_NEW', 'PHONE_USED', 'TABLET', 'ACCESSORY'];
    const categories: CategoryForecast[] = allCategories.map((category) => {
      const currentStock = stockMap.get(category) || 0;
      const sales = salesCountMap.get(category) || { last30: 0, last60: 0, last90: 0 };

      // Weekly rate based on 90-day average
      const weeklyRate = sales.last90 > 0
        ? Number((sales.last90 / (90 / 7)).toFixed(1))
        : 0;

      // Trend: compare last 30d rate vs previous 30d (days 31-60)
      const trend = this.calculateTrend(sales.last30, sales.last60 - sales.last30);

      // Days of stock remaining
      const dailyRate = weeklyRate / 7;
      const daysOfStock = dailyRate > 0
        ? Math.round(currentStock / dailyRate)
        : currentStock > 0 ? 999 : 0; // 999 = effectively infinite if no sales

      const stockHealth: 'OK' | 'LOW' = daysOfStock < 14 && daysOfStock !== 999 ? 'LOW' : 'OK';

      // Suggested reorder: 4 weeks buffer - current stock (only if positive sales)
      let suggestedReorder = 0;
      if (weeklyRate > 0) {
        const targetStock = Math.ceil(weeklyRate * 4);
        suggestedReorder = Math.max(0, targetStock - currentStock);
      }

      return {
        category,
        currentStock,
        salesLast30d: sales.last30,
        salesLast60d: sales.last60,
        salesLast90d: sales.last90,
        weeklyRate,
        trend,
        daysOfStock,
        stockHealth,
        suggestedReorder,
      };
    });

    // Summary
    const totalStock = categories.reduce((sum, c) => sum + c.currentStock, 0);
    const lowStockCategories = categories.filter((c) => c.stockHealth === 'LOW').length;

    return {
      categories,
      slowMoving: slowMovingProducts,
      summary: {
        totalStock,
        lowStockCategories,
        slowMovingCount: slowMovingProducts.length,
      },
    };
  }

  private calculateTrend(
    recentPeriodSales: number,
    previousPeriodSales: number,
  ): 'increasing' | 'stable' | 'decreasing' {
    // Compare last 30 days vs previous 30 days (days 31-60)
    // Use a 20% threshold to determine trend
    if (previousPeriodSales === 0 && recentPeriodSales === 0) return 'stable';
    if (previousPeriodSales === 0 && recentPeriodSales > 0) return 'increasing';

    const changeRate = (recentPeriodSales - previousPeriodSales) / previousPeriodSales;
    if (changeRate > 0.2) return 'increasing';
    if (changeRate < -0.2) return 'decreasing';
    return 'stable';
  }

  private async getSlowMovingProducts(
    sixtyDaysAgo: Date,
    branchFilter: { branchId?: string },
  ): Promise<SlowMovingProduct[]> {
    const now = new Date();

    // Find products that have been in stock for > 60 days
    const oldStockProducts = await this.prisma.product.findMany({
      where: {
        status: 'IN_STOCK',
        deletedAt: null,
        // stockInDate earlier than 60 days ago, or createdAt if stockInDate is null
        OR: [
          { stockInDate: { lt: sixtyDaysAgo } },
          { stockInDate: null, createdAt: { lt: sixtyDaysAgo } },
        ],
        ...branchFilter,
      },
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        stockInDate: true,
        createdAt: true,
      },
    });

    // Check which of these products have had any sales (same brand+model sold)
    // For individual product tracking: if this specific product is still IN_STOCK,
    // it hasn't been sold, so it's slow-moving by definition (in stock > 60 days)
    return oldStockProducts.map((product) => {
      const inStockSince = product.stockInDate || product.createdAt;
      const daysInStock = Math.floor(
        (now.getTime() - inStockSince.getTime()) / (1000 * 60 * 60 * 24),
      );

      return {
        id: product.id,
        name: product.name,
        brand: product.brand,
        daysInStock,
        category: product.category,
      };
    });
  }
}
