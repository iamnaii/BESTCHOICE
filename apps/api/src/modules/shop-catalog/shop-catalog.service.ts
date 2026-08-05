import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { productReadinessWhere } from '../../utils/product-readiness.util';
import { readBoolFlag } from '../../utils/config.util';

export interface ProductGroup {
  /** Representative product id — the catalog card links to /products/:id with this. */
  id: string;
  brand: string;
  model: string;
  storage?: string;
  minPrice: number | null;
  stockCount: number;
  thumbnailUrl?: string;
  conditionGrades: string[];
  monthlyPaymentFrom: number | null;
  condition: 'NEW' | 'USED';
}

export interface ProductDetail {
  id: string;
  brand: string;
  model: string;
  storage?: string;
  color?: string;
  category: string;
  condition: 'NEW' | 'USED';
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
  color?: string;
  shopWarrantyDays?: number;
  cashPrice: number;
  installmentPrice: number | null;
  imeiPartial?: string; // last 4 digits
  gallery: string[];
  gallery360: string[];
}

const INTEREST_RATE_PER_MONTH = 0.0099; // 0.99%/month — example, adjust per pricing config
// B0: unused now that monthlyPaymentFrom is hardcoded to null (calculateMonthlyPayment's
// 2 call sites were removed) — kept for B4, which will re-wire these into a real InterestConfig
// read instead of deleting and re-adding them.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DEFAULT_MONTHS = 12;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DEFAULT_DOWN_PCT = 0.2;
const GROUP_BY = ['brand', 'model', 'storage', 'category'] as const;

// B0 §2.3: เงื่อนไขขึ้นเว็บมาจาก util ตัวเดียว (brand/category/สถานะ/ราคา/รูป/เกรด/[DEMO])
// fragment ใช้คีย์ `AND` เท่านั้น → ปลอดภัยกับ where.OR ที่ listGroupedByModel assign เอง
// `excludeDemo` มาจาก SystemConfig flag `shop_hide_demo_products` ที่ผู้เรียก (แต่ละ public
// method ด้านล่าง) อ่านมาครั้งเดียวต่อ request แล้ว thread เข้ามา — ตาม util's JSDoc contract
// (util นี้ pure ไม่อ่าน SystemConfig เอง)
function shopBaseWhere(excludeDemo: boolean): Record<string, any> {
  return { ...productReadinessWhere({ excludeDemo }) };
}

@Injectable()
export class ShopCatalogService {
  constructor(private prisma: PrismaService) {}

  async listGroupedByModel(filters: {
    page?: number;
    limit?: number;
    brand?: string;
    condition?: 'NEW' | 'USED';
    model?: string;
    conditionGrade?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    search?: string;
  }): Promise<{ data: ProductGroup[]; total: number; page: number; limit: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 24;
    // อ่าน [DEMO] flag ครั้งเดียวต่อ request — ใช้ร่วมกันทั้ง groupBy หลัก + allGroups count
    // (ทั้งคู่ reuse `where` object เดียวกัน ไม่ได้เรียก shopBaseWhere ซ้ำ)
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);

    const where: any = { ...shopBaseWhere(excludeDemo) };
    if (filters.condition) {
      where.category = filters.condition === 'NEW' ? 'PHONE_NEW' : 'PHONE_USED';
    }
    if (filters.model) where.model = filters.model;
    if (filters.conditionGrade) where.conditionGrade = filters.conditionGrade;
    if (filters.minPrice !== undefined)
      where.cashPrice = { ...where.cashPrice, gte: filters.minPrice };
    if (filters.maxPrice !== undefined)
      where.cashPrice = { ...where.cashPrice, lte: filters.maxPrice };
    if (filters.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { brand: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy =
      filters.sort === 'price_asc'
        ? [{ _min: { cashPrice: 'asc' as const } }]
        : filters.sort === 'price_desc'
          ? [{ _min: { cashPrice: 'desc' as const } }]
          : filters.sort === 'newest'
            ? [{ _max: { createdAt: 'desc' as const } }]
            : [{ _count: { id: 'desc' as const } }]; // order by count of id desc = most stock first

    // Group by brand+model+storage+category so new+used of the same model are separate cards
    // that /products/:id renders (getProductDetail filters by the same trio).
    const groups = await this.prisma.product.groupBy({
      by: [...GROUP_BY],
      where,
      _min: { cashPrice: true },
      _count: { id: true },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    });

    // Fetch the cheapest product of each group for the card link target + thumbnail
    const data: ProductGroup[] = await Promise.all(
      groups.map(async (g) => {
        const sample = await this.prisma.product.findFirst({
          where: {
            ...where,
            brand: g.brand,
            model: g.model,
            storage: g.storage,
            category: g.category,
          },
          orderBy: { cashPrice: 'asc' },
          select: { id: true, gallery: true, conditionGrade: true },
        });
        const minPrice = g._min?.cashPrice != null ? Number(g._min.cashPrice) : null;
        const stockCount = g._count?.id ?? 0;
        return {
          id: sample?.id ?? '',
          brand: g.brand,
          model: g.model,
          storage: g.storage ?? undefined,
          minPrice,
          stockCount,
          thumbnailUrl: sample?.gallery[0],
          conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
          // B0: rate 0.99% ที่ใช้อยู่เป็นค่าตัวอย่างในโค้ด (:48 "example, adjust per
          // pricing config") ไม่ใช่ rate ที่ทำสัญญาจริง → ไม่แสดงดีกว่าแสดงผิด
          // เลขจริงที่อ่าน InterestConfig มาใน B4
          monthlyPaymentFrom: null,
          condition: g.category === 'PHONE_NEW' ? 'NEW' : 'USED',
        };
      }),
    );

    // total = number of groups (the UI reads it as "พร้อมจัด X รุ่น"), not unit count
    const allGroups = await this.prisma.product.groupBy({
      by: [...GROUP_BY],
      where,
    });
    return { data, total: allGroups.length, page, limit };
  }

  async listAvailableModels(): Promise<{ model: string; count: number }[]> {
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);
    const rows = await this.prisma.product.groupBy({
      by: ['model'],
      where: shopBaseWhere(excludeDemo),
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' as const } }],
    });
    return rows.map((r) => ({ model: r.model, count: r._count?.id ?? 0 }));
  }

  async listRelated(productId: string): Promise<ProductGroup[]> {
    // [DEMO] flag ครั้งเดียวต่อ request — ใช้ทั้ง head lookup และ related list ด้านล่าง
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);
    const product = await this.prisma.product.findFirst({
      // head lookup เท่านั้น — ต้องตรงกับ getProductDetail (permalink ของเครื่องที่ขายแล้ว)
      where: { id: productId, ...productReadinessWhere({ requireInStock: false, excludeDemo }) },
    });
    if (!product) return [];
    // ตัวรายการ related ยังใช้ shopBaseWhere() ปกติ (ต้องเป็นเครื่องที่ซื้อได้จริง)
    const where = { ...shopBaseWhere(excludeDemo), model: { not: product.model } };
    const groups = await this.prisma.product.groupBy({
      by: [...GROUP_BY],
      where,
      _min: { cashPrice: true },
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' as const } }],
      take: 6,
    });
    return Promise.all(
      groups.map(async (g) => {
        const sample = await this.prisma.product.findFirst({
          where: {
            ...where,
            brand: g.brand,
            model: g.model,
            storage: g.storage,
            category: g.category,
          },
          orderBy: { cashPrice: 'asc' },
          select: { id: true, gallery: true, conditionGrade: true },
        });
        const minPrice = g._min?.cashPrice != null ? Number(g._min.cashPrice) : null;
        return {
          id: sample?.id ?? '',
          brand: g.brand,
          model: g.model,
          storage: g.storage ?? undefined,
          minPrice,
          stockCount: g._count?.id ?? 0,
          thumbnailUrl: sample?.gallery[0],
          conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
          // B0: rate 0.99% ที่ใช้อยู่เป็นค่าตัวอย่างในโค้ด (:48 "example, adjust per
          // pricing config") ไม่ใช่ rate ที่ทำสัญญาจริง → ไม่แสดงดีกว่าแสดงผิด
          // เลขจริงที่อ่าน InterestConfig มาใน B4
          monthlyPaymentFrom: null,
          condition: g.category === 'PHONE_NEW' ? 'NEW' : 'USED',
        };
      }),
    );
  }

  async getProductDetail(productId: string): Promise<ProductDetail | null> {
    // [DEMO] flag อ่านครั้งเดียวต่อ request — ใช้ร่วมกันทั้ง head query + units query ด้านล่าง
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        // ไม่บังคับ IN_STOCK — เครื่องที่ขายแล้วต้องยังเปิดหน้ารุ่นได้ (permalink)
        ...productReadinessWhere({ requireInStock: false, excludeDemo }),
      },
    });
    if (!product) return null;

    // Get all units (same brand+model+storage+category, พร้อมขายจริง)
    const allUnits = await this.prisma.product.findMany({
      where: {
        model: product.model,
        storage: product.storage,
        category: product.category,
        ...productReadinessWhere({ excludeDemo }),
      },
      orderBy: { cashPrice: 'asc' },
    });

    const tiers: Record<string, { minPrice: number; maxPrice: number; units: ProductUnit[] }> = {};
    for (const u of allUnits) {
      // B0: readiness fragment กรอง cashPrice > 0 มาแล้ว — ถ้ายังเจอ null แปลว่า
      // ข้อมูลไม่ครบ ให้ตกจากรายการแทนการโชว์ ฿0 (เคยหลอกลูกค้าว่าเครื่องฟรี)
      if (u.cashPrice == null) continue;
      const grade = u.conditionGrade ?? 'unknown';
      if (!tiers[grade]) tiers[grade] = { minPrice: Infinity, maxPrice: 0, units: [] };
      const price = Number(u.cashPrice);
      const imeiPartial = u.imeiSerial ? `••••••••••${u.imeiSerial.slice(-4)}` : undefined;
      tiers[grade].units.push({
        id: u.id,
        conditionGrade: grade,
        batteryHealth: u.batteryHealth ?? undefined,
        hasBox: u.hasBox ?? undefined,
        color: u.color ?? undefined,
        shopWarrantyDays: u.shopWarrantyDays ?? undefined,
        cashPrice: price,
        installmentPrice: u.installmentPrice != null ? Number(u.installmentPrice) : null,
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
      condition: product.category === 'PHONE_NEW' ? 'NEW' : 'USED',
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
