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
  /** Up to 5 photos for the card's photo strip. */
  images: string[];
  /** 'UNIT' = one physical second-hand device. 'GROUP' = a model+storage of
   *  sealed new stock, where one unit is interchangeable with the next. */
  kind: 'UNIT' | 'GROUP';
  /** Customer-facing device number ("#4218"). Units only. */
  displayNo?: string;
  /** Units only — the grade of THIS device, not a list across the group. */
  conditionGrade?: string;
  color?: string;
  batteryHealth?: number;
  /** Derived badges (battery / warranty / box / just-arrived). Units only. */
  tags: string[];
  /** Down payment in baht for the requested downPct on THIS device's price. */
  downAmount: number | null;
  /** Tenure the monthly figure is quoted at — a monthly with no งวด is a
   *  half-truth, so the card always prints it. */
  installmentMonths: number | null;
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

import {
  deriveUnitTags,
  deriveDisplayNo,
  modelRank,
  gradeRank,
} from './catalog-item.util';

const GROUP_BY = ['brand', 'model', 'storage', 'category'] as const;

/** Photos returned per catalog card. The card shows one large image plus a
 *  strip of up to four thumbnails, so anything past five is dead weight. */
const CARD_PHOTO_LIMIT = 5;

/** A card plus the keys the merged list is ordered on. */
interface SortableCard {
  item: ProductGroup;
  price: number | null;
  /** createdAt, for the explicit "newest arrivals" sort. */
  at: number;
  /** Model generation+tier — the default ordering. */
  rank: number;
  /** A→B→C within one model. */
  grade: number;
  isGroup: boolean;
}

/** Upper bound on used-device rows pulled for one catalog page. */
const MAX_UNIT_SCAN = 2000;

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
    /** Shopper's chosen down payment, in percent. Clamped up to each category's
     *  minimum — we never quote a plan the finance side would reject. */
    downPct?: number;
    /** Shopper's chosen tenure. Falls back to the longest allowed (= lowest
     *  monthly), which is what the page showed before this was adjustable. */
    months?: number;
  }): Promise<{
    data: ProductGroup[];
    total: number;
    page: number;
    limit: number;
    /** Highest minimum-down across the categories on this page — the slider
     *  cannot go below it. Sent so the UI has no hardcoded percentage. */
    minDownPct: number | null;
    /** Tenures the rate table actually allows, so the picker cannot offer a
     *  plan that would silently fall back to a different number of งวด. */
    monthsOptions: number[];
  }> {
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

    // ── Second-hand lists per DEVICE, new stock lists per MODEL ──────────
    // Owner rule 2026-08-21: "มือสอง ต้องเครื่องใครเครื่องมันสิ". Collapsing four
    // used devices into one "4 เครื่อง" card hides exactly what the buyer needs
    // to choose between them (grade, battery, colour, price). Sealed new stock
    // is genuinely interchangeable, so that still groups.
    const wantsNew = filters.condition !== 'USED';
    const wantsUsed = filters.condition !== 'NEW';

    const [groups, unitRows] = await Promise.all([
      wantsNew
        ? this.prisma.product.groupBy({
            by: [...GROUP_BY],
            where: { ...where, category: 'PHONE_NEW' },
            _min: { cashPrice: true, installmentPrice: true },
            _max: { createdAt: true },
            _count: { id: true },
          })
        : Promise.resolve([] as any[]),
      wantsUsed
        ? this.prisma.product.findMany({
            where: { ...where, category: 'PHONE_USED' },
            orderBy: { createdAt: 'desc' },
            // Merging two differently-shaped result sets means sorting and
            // paginating in memory, so the read is bounded. The shop carries
            // several hundred live units; if this cap is ever hit the fix is a
            // single-shape unit query with DB-level paging, not a bigger cap.
            take: MAX_UNIT_SCAN,
            select: {
              id: true,
              brand: true,
              model: true,
              storage: true,
              color: true,
              category: true,
              cashPrice: true,
              installmentPrice: true,
              conditionGrade: true,
              batteryHealth: true,
              hasBox: true,
              warrantyExpireDate: true,
              warrantyExpired: true,
              stockInDate: true,
              imeiSerial: true,
              gallery: true,
              createdAt: true,
            },
          })
        : Promise.resolve([] as any[]),
    ]);

    const configs = await this.resolveConfigsFor([
      ...groups.map((g: any) => g.category),
      ...(unitRows.length > 0 ? (['PHONE_USED'] as const) : []),
    ]);
    const now = new Date();

    // New stock: one card per model+storage, with the cheapest unit as the face.
    const groupItems: SortableCard[] = await Promise.all(
        groups.map(async (g: any) => {
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
          const quote = this.installmentFor(minInstallment, configs.get(g.category) ?? null, {
            downPct: filters.downPct,
            months: filters.months,
          });
          return {
            price: minPrice,
            at: g._max?.createdAt ? new Date(g._max.createdAt).getTime() : 0,
            rank: modelRank(g.model),
            grade: gradeRank(null),
            isGroup: true,
            item: {
              kind: 'GROUP' as const,
              id: sample?.id ?? '',
              brand: g.brand,
              model: g.model,
              storage: g.storage ?? undefined,
              minPrice,
              stockCount,
              thumbnailUrl: sample?.gallery[0],
              images: (sample?.gallery ?? []).slice(0, CARD_PHOTO_LIMIT),
              conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
              monthlyPaymentFrom: quote?.monthly ?? null,
              downAmount: quote?.downAmount ?? null,
              installmentMonths: quote?.months ?? null,
              condition: 'NEW' as const,
              tags: [],
            },
          };
        }),
      );

    // Second-hand: one card per physical device.
    const usedConfig = configs.get('PHONE_USED') ?? null;
    const unitItems = unitRows.map((u: any) => {
      const price = u.cashPrice != null ? Number(u.cashPrice) : null;
      const quote = this.installmentFor(
        u.installmentPrice != null ? Number(u.installmentPrice) : null,
        usedConfig,
        { downPct: filters.downPct, months: filters.months },
      );
      return {
        price,
        at: u.createdAt ? new Date(u.createdAt).getTime() : 0,
        rank: modelRank(u.model),
        grade: gradeRank(u.conditionGrade),
        isGroup: false,
        item: {
          kind: 'UNIT' as const,
          id: u.id,
          displayNo: deriveDisplayNo(u.imeiSerial),
          brand: u.brand,
          model: u.model,
          storage: u.storage ?? undefined,
          color: u.color ?? undefined,
          minPrice: price,
          stockCount: 1,
          thumbnailUrl: u.gallery?.[0],
          images: (u.gallery ?? []).slice(0, CARD_PHOTO_LIMIT),
          conditionGrade: u.conditionGrade ?? undefined,
          conditionGrades: u.conditionGrade ? [u.conditionGrade] : [],
          batteryHealth: u.batteryHealth ?? undefined,
          monthlyPaymentFrom: quote?.monthly ?? null,
          downAmount: quote?.downAmount ?? null,
          installmentMonths: quote?.months ?? null,
          condition: 'USED' as const,
          tags: deriveUnitTags(u, now),
        },
      };
    });

    const merged = [...groupItems, ...unitItems];
    // Default order is by MODEL, newest generation first (owner, 2026-08-21):
    // every iPhone 15 Pro Max sits together and 16 comes before 15. Within one
    // model: new stock heads the block, then second-hand best-grade first, then
    // dearest first. `popular` maps here too — it used to mean "deepest stock",
    // which says nothing to a shopper and means even less now that used devices
    // list one card each.
    merged.sort((a, b) => {
      if (filters.sort === 'price_asc') return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (filters.sort === 'price_desc') return (b.price ?? -Infinity) - (a.price ?? -Infinity);
      if (filters.sort === 'newest') return b.at - a.at;
      if (a.rank !== b.rank) return b.rank - a.rank;
      if (a.isGroup !== b.isGroup) return a.isGroup ? -1 : 1;
      if (a.grade !== b.grade) return a.grade - b.grade;
      return (b.price ?? 0) - (a.price ?? 0);
    });

    const total = merged.length;
    const data: ProductGroup[] = merged.slice((page - 1) * limit, page * limit).map((m) => m.item);

    // The slider must not offer a down payment the finance side would reject.
    const mins = [...configs.values()]
      .filter((c): c is BcConfig => c != null)
      .map((c) => c.minDownPct.mul(100).toNumber());
    const minDownPct = mins.length > 0 ? Math.max(...mins) : null;
    const monthsOptions = [
      ...new Set(
        [...configs.values()].filter((c): c is BcConfig => c != null).flatMap((c) => c.allowedMonths),
      ),
    ].sort((a, b) => a - b);

    return { data, total, page, limit, minDownPct, monthsOptions };
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
          select: {
            id: true,
            gallery: true,
            conditionGrade: true,
            color: true,
            cashPrice: true,
            installmentPrice: true,
            batteryHealth: true,
            hasBox: true,
            warrantyExpireDate: true,
            warrantyExpired: true,
            stockInDate: true,
            imeiSerial: true,
          },
        });
        const isNew = g.category === 'PHONE_NEW';
        // "Related" spans other MODELS, so it stays one card per model. For
        // second-hand that card describes the cheapest real device of that
        // model rather than an averaged-out group — same rule as the grid.
        const minPrice = isNew
          ? g._min?.cashPrice != null
            ? Number(g._min.cashPrice)
            : null
          : sample?.cashPrice != null
            ? Number(sample.cashPrice)
            : null;
        const installment = isNew
          ? g._min?.installmentPrice != null
            ? Number(g._min.installmentPrice)
            : null
          : sample?.installmentPrice != null
            ? Number(sample.installmentPrice)
            : null;
        const quote = this.installmentFor(installment, configs.get(g.category) ?? null);
        return {
          kind: (isNew ? 'GROUP' : 'UNIT') as 'GROUP' | 'UNIT',
          id: sample?.id ?? '',
          displayNo: isNew ? undefined : deriveDisplayNo(sample?.imeiSerial),
          brand: g.brand,
          model: g.model,
          storage: g.storage ?? undefined,
          color: isNew ? undefined : (sample?.color ?? undefined),
          minPrice,
          stockCount: isNew ? (g._count?.id ?? 0) : 1,
          thumbnailUrl: sample?.gallery[0],
          images: (sample?.gallery ?? []).slice(0, CARD_PHOTO_LIMIT),
          conditionGrade: isNew ? undefined : (sample?.conditionGrade ?? undefined),
          conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
          batteryHealth: isNew ? undefined : (sample?.batteryHealth ?? undefined),
          monthlyPaymentFrom: quote?.monthly ?? null,
          downAmount: quote?.downAmount ?? null,
          installmentMonths: quote?.months ?? null,
          condition: (isNew ? 'NEW' : 'USED') as 'NEW' | 'USED',
          tags: isNew || !sample ? [] : deriveUnitTags(sample),
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

  /** Stock line for a catalog card. A second-hand UNIT is one specific phone —
   *  "เหลือ 1 เครื่อง — ใกล้หมด" would fire on literally every used card and stop
   *  meaning anything, so units get their own wording. */
  stockLabelFor(item: { kind?: 'UNIT' | 'GROUP'; stockCount: number }): {
    display: string;
    tone: 'out' | 'urgent' | 'low' | 'available' | 'unique';
  } {
    if (item.kind === 'UNIT') return { display: 'เครื่องนี้มีตัวเดียว', tone: 'unique' };
    return this.smartStockCount(item.stockCount);
  }

  smartStockCount(n: number): { display: string; tone: 'out' | 'urgent' | 'low' | 'available' } {
    if (n === 0) return { display: 'หมดสต็อก — ทักแชทเช็ครอบเข้าใหม่', tone: 'out' };
    if (n <= 3) return { display: `เหลือ ${n} เครื่อง — ใกล้หมด`, tone: 'urgent' };
    if (n <= 10) return { display: `เหลือ ${n} เครื่อง`, tone: 'low' };
    return { display: 'ในสต็อก พร้อมส่ง', tone: 'available' };
  }

  /**
   * "ผ่อนเริ่มต้น" ของกลุ่ม = ค่างวดต่ำสุดที่ทำสัญญาได้จริง
   * (งวดยาวสุดที่มีเรต + ดาวน์ขั้นต่ำตาม InterestConfig) ผ่านเครื่องคิดตัวเดียว
   * กับ InstallmentPreviewService — ห้ามคำนวณเองด้วยสูตรย่อ
   */
  /**
   * One installment quote for a card. Goes through `calcBcInstallment` — the
   * same function the detail page's preview uses — so the grid and the detail
   * page can never drift (red line §10, guarded by the parity spec).
   */
  private installmentFor(
    installmentPrice: number | null,
    config: BcConfig | null,
    opts?: { downPct?: number; months?: number },
  ): { monthly: number; downAmount: number; months: number } | null {
    if (installmentPrice == null || installmentPrice <= 0) return null;
    if (!config || config.allowedMonths.length === 0) return null;

    // Longest tenure = lowest monthly, which is what the card showed before the
    // shopper could pick. An out-of-range request falls back rather than 400s.
    const requested = opts?.months;
    const months =
      requested != null && config.allowedMonths.includes(requested)
        ? requested
        : config.allowedMonths[config.allowedMonths.length - 1];

    const asked = opts?.downPct != null ? new Decimal(opts.downPct).div(100) : config.minDownPct;
    const downPct = Decimal.max(asked, config.minDownPct);

    const result = calcBcInstallment({
      installmentPrice: new Decimal(installmentPrice),
      months,
      downPct,
      config,
    });
    if (!result.isValid) return null;
    return {
      monthly: Math.ceil(result.monthlyPayment.toNumber()),
      downAmount: Math.ceil(result.downAmount.toNumber()),
      months,
    };
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
