import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { productReadinessWhere } from '../../utils/product-readiness.util';
import { readBoolFlag } from '../../utils/config.util';
import { calcBcInstallment } from '../../utils/installment-calc.util';
import { resolveBcConfigForCategory } from '../../utils/bc-installment-config.util';
import type { BcConfig } from '../../utils/installment-calc.types';
import { parseAccessories, parseQcChecklist, QcCheckItem } from './product-unit-detail.util';
import { parseDeviceQuery } from '../../utils/device-query-normalize.util';

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
  /** ค่างวดต่ำสุดที่ทำสัญญาได้จริง (งวดยาวสุด + ดาวน์ต่ำสุด); null = ยังไม่ตั้งราคาผ่อน */
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
  /** ชื่อสาขาที่เครื่องนี้อยู่ — ลูกค้าถามบ่อยว่า "อยู่สาขาไหน" */
  branchName?: string;
  /** อุปกรณ์ที่ให้ไปกับเครื่อง (รวม 'กล่อง' จาก hasBox) */
  accessories: string[];
  /** ตำหนิ/รอยที่แจ้งลูกค้าตรง ๆ */
  cosmeticNotes?: string;
  /** ผลตรวจ QC รายข้อ (เฉพาะที่เก็บเป็น checklist จริง) */
  qcChecklist: QcCheckItem[];
}

const GROUP_BY = ['brand', 'model', 'storage', 'category'] as const;

// B0 §2.3: เงื่อนไขขึ้นเว็บมาจาก util ตัวเดียว (brand/category/สถานะ/ราคา/รูป/เกรด/[DEMO])
// fragment ใช้คีย์ `AND` เท่านั้น → ประกอบต่อกับเงื่อนไข search (Task 7) ที่ต่อเข้า
// `where.AND` เช่นกันได้อย่างปลอดภัย ไม่มีคีย์ชนกัน
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
      // util กลางจาก B0 — ตัวเดียวกับที่บอทและ inbox ใช้ เพื่อให้ "ไอโฟน 15 โปร"
      // ที่ลูกค้าพิมพ์ในเว็บกับในแชทให้ผลเดียวกัน
      const parsed = parseDeviceQuery(q);
      const clauses: Record<string, unknown>[] = [];
      if (parsed.model) clauses.push({ model: { contains: parsed.model, mode: 'insensitive' } });
      if (parsed.storage)
        clauses.push({ storage: { equals: parsed.storage, mode: 'insensitive' } });
      // ⚠️ ห้ามใส่ parsed.color ลง where: util คืนคำไทย ('ดำ') แต่ Product.color
      // เก็บอังกฤษ ('Black') → จะกลายเป็นเงื่อนไขที่ไม่มีวันจริง = 0 ผลลัพธ์
      // สีใช้เป็น "narrowing แบบ no-op" หลัง query แทน (แบบเดียวกับ B3
      // search-products.tool: `if (byColor.length > 0) candidates = byColor`)
      // brand ถูกตรึงเป็น Apple ใน readiness fragment อยู่แล้ว จึงไม่ต้องใช้ parsed.brand
      if (clauses.length === 0) {
        clauses.push({
          OR: [
            { brand: { contains: q, mode: 'insensitive' } },
            { model: { contains: q, mode: 'insensitive' } },
          ],
        });
      }
      // ต่อ AND เสมอ — ห้ามเขียนทับ where ด้วยเงื่อนไข OR ระดับบนสุดตรง ๆ เพราะจะชนกับ
      // fragment readiness/base ที่ประกอบมาเป็น {AND:[...]} อยู่แล้ว
      where.AND = [...((where.AND as unknown[]) ?? []), ...clauses];
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
      _min: { cashPrice: true, installmentPrice: true },
      _count: { id: true },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    });

    const configs = await this.resolveConfigsFor(groups.map((g) => g.category));

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
        const minInstallment =
          g._min?.installmentPrice != null ? Number(g._min.installmentPrice) : null;
        const stockCount = g._count?.id ?? 0;
        const monthly = this.monthlyFrom(minInstallment, configs.get(g.category) ?? null);
        return {
          id: sample?.id ?? '',
          brand: g.brand,
          model: g.model,
          storage: g.storage ?? undefined,
          minPrice,
          stockCount,
          thumbnailUrl: sample?.gallery[0],
          conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
          monthlyPaymentFrom: monthly,
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
      _min: { cashPrice: true, installmentPrice: true },
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' as const } }],
      take: 6,
    });
    const configs = await this.resolveConfigsFor(groups.map((g) => g.category));
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
        const minInstallment =
          g._min?.installmentPrice != null ? Number(g._min.installmentPrice) : null;
        const monthly = this.monthlyFrom(minInstallment, configs.get(g.category) ?? null);
        return {
          id: sample?.id ?? '',
          brand: g.brand,
          model: g.model,
          storage: g.storage ?? undefined,
          minPrice,
          stockCount: g._count?.id ?? 0,
          thumbnailUrl: sample?.gallery[0],
          conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
          monthlyPaymentFrom: monthly,
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
      include: { branch: { select: { name: true } } },
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
        branchName: u.branch?.name ?? undefined,
        accessories: parseAccessories(u.accessoriesIncluded, u.hasBox),
        cosmeticNotes: u.cosmeticNotes ?? undefined,
        qcChecklist: parseQcChecklist(u.checklistResults),
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

  /**
   * "ผ่อนเริ่มต้น" ของกลุ่ม = ค่างวดต่ำสุดที่ทำสัญญาได้จริง
   * (งวดยาวสุดที่มีเรต + ดาวน์ขั้นต่ำตาม InterestConfig) ผ่านเครื่องคิดตัวเดียว
   * กับ InstallmentPreviewService — ห้ามคำนวณเองด้วยสูตรย่อ
   */
  private monthlyFrom(installmentPrice: number | null, config: BcConfig | null): number | null {
    if (installmentPrice == null || installmentPrice <= 0) return null;
    if (!config || config.allowedMonths.length === 0) return null;
    const months = config.allowedMonths[config.allowedMonths.length - 1];
    const result = calcBcInstallment({
      installmentPrice: new Decimal(installmentPrice),
      months,
      downPct: config.minDownPct,
      config,
    });
    if (!result.isValid) return null;
    return Math.ceil(result.monthlyPayment.toNumber());
  }

  /** resolve config ครั้งเดียวต่อ category ต่อ request (กลุ่มมีได้แค่ 2 category) */
  private async resolveConfigsFor(categories: string[]): Promise<Map<string, BcConfig | null>> {
    const unique = Array.from(new Set(categories));
    const entries = await Promise.all(
      unique.map(async (c) => {
        const r = await resolveBcConfigForCategory(this.prisma, c);
        return [c, r.found ? r.config! : null] as const;
      }),
    );
    return new Map(entries);
  }
}
