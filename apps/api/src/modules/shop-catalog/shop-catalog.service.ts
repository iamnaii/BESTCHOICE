import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  conditionGrades: string[];
  monthlyPaymentFrom: number;
}

export interface ProductDetail {
  id: string;
  brand: string;
  model: string;
  storage?: string;
  color?: string;
  category: string;
  description?: string;
  gallery: string[];
  gallery360: string[];
  tiers: Record<string, { minPrice: number; maxPrice: number; units: ProductUnit[] }>;
  cashPrice: number | null;
  installmentPrice: number | null;
}

export interface ProductUnit {
  id: string;
  conditionGrade: string;
  batteryHealth?: number;
  hasBox?: boolean;
  hasCharger?: boolean;
  hasHeadphones?: boolean;
  shopWarrantyDays?: number;
  costPrice: number;
  imeiPartial?: string; // last 4 digits
  gallery: string[];
  gallery360: string[];
}

const INTEREST_RATE_PER_MONTH = 0.0099; // 0.99%/month — example, adjust per pricing config
const DEFAULT_MONTHS = 12;
const DEFAULT_DOWN_PCT = 0.2;

@Injectable()
export class ShopCatalogService {
  constructor(private prisma: PrismaService) {}

  async listGroupedByModel(filters: {
    page?: number;
    limit?: number;
    brand?: string;
    conditionGrade?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
  }): Promise<{ data: ProductGroup[]; total: number; page: number; limit: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 24;

    const where: any = {
      deletedAt: null,
      isOnlineVisible: true,
      status: 'IN_STOCK',
    };
    if (filters.brand) where.brand = filters.brand;
    if (filters.conditionGrade) where.conditionGrade = filters.conditionGrade;
    if (filters.minPrice !== undefined) where.costPrice = { ...where.costPrice, gte: filters.minPrice };
    if (filters.maxPrice !== undefined) where.costPrice = { ...where.costPrice, lte: filters.maxPrice };

    const orderBy =
      filters.sort === 'price_asc' ? [{ _min: { costPrice: 'asc' as const } }] :
      filters.sort === 'price_desc' ? [{ _min: { costPrice: 'desc' as const } }] :
      filters.sort === 'newest' ? [{ _max: { createdAt: 'desc' as const } }] :
      [{ _count: { id: 'desc' as const } }]; // order by count of id desc = most stock first

    const groups = await this.prisma.product.groupBy({
      by: ['brand', 'model'],
      where,
      _min: { costPrice: true },
      _count: { id: true },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    });

    // Fetch first product of each group for thumbnail
    const data: ProductGroup[] = await Promise.all(groups.map(async (g) => {
      const sample = await this.prisma.product.findFirst({
        where: { ...where, brand: g.brand, model: g.model },
        select: { gallery: true, conditionGrade: true },
      });
      const minPrice = Number(g._min?.costPrice ?? 0);
      const stockCount = g._count?.id ?? 0;
      const monthly = this.calculateMonthlyPayment(minPrice, DEFAULT_MONTHS, DEFAULT_DOWN_PCT);
      return {
        brand: g.brand,
        model: g.model,
        minPrice,
        stockCount,
        thumbnailUrl: sample?.gallery[0],
        conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
        monthlyPaymentFrom: monthly,
      };
    }));

    const total = await this.prisma.product.count({ where });
    return { data, total, page, limit };
  }

  async getProductDetail(productId: string): Promise<ProductDetail | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null, isOnlineVisible: true },
    });
    if (!product) return null;

    // Get all units (same brand+model, in stock)
    const allUnits = await this.prisma.product.findMany({
      where: {
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        deletedAt: null,
        isOnlineVisible: true,
        status: 'IN_STOCK',
      },
      orderBy: { costPrice: 'asc' },
    });

    const tiers: Record<string, { minPrice: number; maxPrice: number; units: ProductUnit[] }> = {};
    for (const u of allUnits) {
      const grade = u.conditionGrade ?? 'unknown';
      if (!tiers[grade]) tiers[grade] = { minPrice: Infinity, maxPrice: 0, units: [] };
      const price = Number(u.costPrice);
      const imeiPartial = u.imeiSerial ? `••••••••••${u.imeiSerial.slice(-4)}` : undefined;
      tiers[grade].units.push({
        id: u.id,
        conditionGrade: grade,
        batteryHealth: u.batteryHealth ?? undefined,
        hasBox: u.hasBox ?? undefined,
        shopWarrantyDays: u.shopWarrantyDays ?? undefined,
        costPrice: price,
        imeiPartial,
        gallery: u.gallery,
        gallery360: u.gallery360,
      });
      if (price < tiers[grade].minPrice) tiers[grade].minPrice = price;
      if (price > tiers[grade].maxPrice) tiers[grade].maxPrice = price;
    }

    return {
      id: product.id,
      brand: product.brand,
      model: product.model,
      storage: product.storage ?? undefined,
      color: product.color ?? undefined,
      category: product.category,
      description: product.onlineDescription ?? undefined,
      gallery: product.gallery,
      gallery360: product.gallery360,
      tiers,
      cashPrice: product.cashPrice !== null ? Number(product.cashPrice) : null,
      installmentPrice: product.installmentPrice !== null ? Number(product.installmentPrice) : null,
    };
  }

  smartStockCount(n: number): { display: string; tone: 'out' | 'urgent' | 'low' | 'available' } {
    if (n === 0) return { display: 'หมดสต็อก แจ้งเตือนเมื่อมาใหม่', tone: 'out' };
    if (n <= 3) return { display: `เหลือ ${n} เครื่อง — ใกล้หมด`, tone: 'urgent' };
    if (n <= 10) return { display: `เหลือ ${n} เครื่อง`, tone: 'low' };
    return { display: 'ในสต็อก พร้อมส่ง', tone: 'available' };
  }

  calculateMonthlyPayment(price: number, months: number, downPct: number): number {
    const downPayment = price * downPct;
    const financed = price - downPayment;
    const totalInterest = financed * INTEREST_RATE_PER_MONTH * months;
    return Math.round((financed + totalInterest) / months);
  }
}
