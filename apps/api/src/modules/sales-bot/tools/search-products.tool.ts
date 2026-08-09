import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseDeviceQuery, normalizeStorage } from '../../../utils/device-query-normalize.util';
import { DEMO_NAME_PREFIX } from '../../../utils/product-readiness.util';
import { shopBaseUrl } from '../../../utils/shop-base-url.util';
import { readBoolFlag } from '../../../utils/config.util';

export const SEARCH_PRODUCTS_TOOL = {
  name: 'search_products',
  description:
    'ค้นสต็อกจริงของ BESTCHOICE ด้วยคำพูดลูกค้าได้ตรง ๆ (ไทย/อังกฤษ/คำย่อ เช่น "ไอโฟน 15 โปรแม็กซ์ 256 สีดำ", "ip15"). ' +
    'คืนผลจัดกลุ่มตาม รุ่น+ความจุ+สภาพ พร้อมจำนวนเครื่อง ช่วงราคา และรายละเอียดรายเครื่อง ' +
    '(ราคาเงินสด/ราคาผ่อน/สี/แบต/ประกันร้าน/อุปกรณ์ที่แถม/ตำหนิ/สาขา/มีรูปไหม/ลิงก์เว็บ). ' +
    'เครื่องที่ติดจองอยู่จะมี reserved=true — บอกลูกค้าว่า "มีของแต่ติดจองชั่วคราว" ห้ามบอกว่าไม่มี. ' +
    'groups[].reservedCount = จำนวนเครื่องติดจองทั้งกลุ่ม (นับรวมแม้บางเครื่องจะไม่ได้อยู่ใน units[] เพราะแสดงได้จำกัด) — ใช้บอกจำนวนติดจองได้แม้ units[] จะไม่ครบทุกเครื่อง. ' +
    'priceMissingCount > 0 แปลว่ามีเครื่องตรงรุ่นแต่ยังไม่ได้ตั้งราคา — อย่าเดาราคาเอง ให้ใช้ get_installment_rates ตอบเรทกลางแทน. ' +
    'ห้าม quote ตัวเลขใด ๆ ที่ไม่ได้มาจากผลลัพธ์นี้.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'คำที่ลูกค้าพิมพ์มาเลย เช่น "ไอโฟน 15 โปรแม็กซ์ 256gb" หรือ "iPhone 13"',
      },
      maxPriceThb: { type: 'number', description: 'งบสูงสุดของลูกค้า (บาท) ถ้ามีบอก' },
    },
    required: ['query'],
  },
};

/** จำนวนกลุ่มสูงสุดที่ส่งให้โมเดล — มากกว่านี้ข้อความจะยาวเกินอ่านในแชท */
const MAX_GROUPS = 5;
/** จำนวนเครื่องต่อกลุ่ม */
const MAX_UNITS_PER_GROUP = 3;
/** เพดาน candidate จาก DB ก่อนจัดกลุ่ม */
const CANDIDATE_TAKE = 40;

export const RESERVED_NOTE = 'ติดจองชั่วคราว';

export interface SearchProductUnit {
  id: string;
  priceThb: number;
  installmentPriceThb: number | null;
  color: string | null;
  batteryHealth: number | null;
  shopWarrantyDays: number | null;
  accessories: string[] | null;
  cosmeticNotes: string | null;
  branchName: string | null;
  photoAvailable: boolean;
  photoUrl: string | null;
  webUrl: string | null;
  reserved: boolean;
  reservedNote?: string;
}

export interface SearchProductGroup {
  brand: string;
  model: string;
  storage: string | null;
  condition: string;
  unitCount: number;
  minPrice: number;
  maxPrice: number;
  /**
   * จำนวนเครื่อง RESERVED ทั้งหมดในกลุ่ม — นับ**ก่อน**ตัด `units[]` เหลือ
   * `MAX_UNITS_PER_GROUP`. review round 1 [I2]: ถ้ากลุ่มมีเครื่องพร้อมขาย
   * ≥3 เครื่อง `.slice(0, MAX_UNITS_PER_GROUP)` จะตัดเครื่องติดจองออกจาก
   * `units[]` ไปเงียบ ๆ — ลูกค้าจะเข้าใจผิดว่า "หมด" ทั้งที่ยังมีของติดจองอยู่
   * (ขัดกับ spec §5 ที่สั่งชัดว่าต้องรู้ว่าติดจอง ไม่ใช่หายไป). field นี้ทำให้
   * บอทพูด "ติดจอง N เครื่อง" ได้เสมอแม้ unit นั้นจะโดน slice ทิ้งไปแล้วก็ตาม.
   * ไม่ใช่ตัวเลขเงิน — ไม่อยู่ใน GROUNDED_PRICE_KEYS โดยเจตนา (ดูคอมเมนต์ที่
   * price-grounding.util.ts และ fixture)
   */
  reservedCount: number;
  units: SearchProductUnit[];
}

export interface SearchProductsResult {
  query: { brand: string | null; model: string | null; storage: string | null; color: string | null };
  totalMatches: number;
  priceMissingCount: number;
  groups: SearchProductGroup[];
}

@Injectable()
export class SearchProductsTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { query: string; maxPriceThb?: number }): Promise<SearchProductsResult> {
    const raw = String(input?.query ?? '').trim();
    const parsed = parseDeviceQuery(raw);
    const emptyResult: SearchProductsResult = {
      query: { brand: parsed.brand, model: parsed.model, storage: parsed.storage, color: parsed.color },
      totalMatches: 0,
      priceMissingCount: 0,
      groups: [],
    };
    if (!raw) return emptyResult;

    // คำที่ใช้ contains-match: รุ่นที่ parse ได้ก่อน แล้วค่อยคำดิบ (เผื่อ parse ไม่ออก
    // เช่นชื่อรุ่นแบรนด์อื่น) — dedupe + ตัดคำสั้นกว่า 2 ตัวอักษรทิ้ง
    const terms = [...new Set([parsed.model, parsed.brand, parsed.rest, raw])]
      .filter((t): t is string => !!t && t.trim().length >= 2)
      .map((t) => t.trim());
    if (terms.length === 0) return emptyResult;

    // QA blocker (Task 15, 2026-08-09): brief เดิมสั่งกรอง [DEMO] แบบ unconditional —
    // ขัดกับเว็บ storefront ที่อ่าน SystemConfig `shop_hide_demo_products` แล้วโชว์ [DEMO]
    // เมื่อ flag เป็น false/ไม่มีแถว (owner decision: โชว์จนกว่าจะเปิดร้านจริง — ดู
    // shop-catalog.service.ts + product-readiness.util.ts). prod catalog วันนี้เป็น
    // [DEMO] ล้วน — ถ้ากรองไม่มีเงื่อนไข บอทจะตอบ "ของหมด" กับเครื่องที่ลูกค้าเห็นอยู่บนเว็บ
    // จริง ๆ ขัด invariant ของเวฟ "บอทตอบได้เท่าเว็บ" — ใช้ flag เดียวกับเว็บเป๊ะ ๆ ตรงนี้
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      isOnlineVisible: true,
      // spec §5: บอทต้องเห็นเครื่องที่ติดจองด้วย เพื่อตอบว่า "มีของแต่ติดจอง"
      status: { in: ['IN_STOCK', 'RESERVED'] },
      // flag true → กรอง [DEMO] ทิ้ง (เหมือนเว็บ); false/ไม่มีแถว → รวม [DEMO] ในผลลัพธ์
      // (เหมือนเว็บ) — หมายเหตุ: tool นี้ไม่เคยส่ง Product.name (ที่มี prefix [DEMO])
      // ออกไปให้โมเดลอยู่แล้ว (ส่งแค่ brand/model column) จึงไม่มีความเสี่ยงที่บอทจะพูด
      // ชื่อ "[DEMO] ..." แปลก ๆ ไม่ว่า flag จะเป็นค่าไหน
      ...(excludeDemo ? { NOT: { name: { startsWith: DEMO_NAME_PREFIX } } } : {}),
      OR: terms.flatMap((t) => [
        { name: { contains: t, mode: 'insensitive' as const } },
        { brand: { contains: t, mode: 'insensitive' as const } },
        { model: { contains: t, mode: 'insensitive' as const } },
      ]),
      AND: [
        // มือสองต้องผ่าน QC (มีเกรด) ถึงจะเสนอลูกค้าได้ — ห่อใน AND เพราะ OR
        // ระดับบนสุดถูกใช้เป็นคำค้นไปแล้ว
        {
          OR: [
            { category: { not: 'PHONE_USED' } },
            { AND: [{ conditionGrade: { not: null } }, { conditionGrade: { not: '' } }] },
          ],
        },
      ],
      // ⚠️ ไม่มีเงื่อนไข gallery โดยเจตนา (spec §5): บังคับรูปแบบเว็บจะซ่อนสต็อก
      // ที่ขายได้จริงออกจากแชท — บอกความจริงผ่าน photoAvailable แทน
    };

    const rows = await this.prisma.product.findMany({
      where,
      take: CANDIDATE_TAKE,
      orderBy: [{ cashPrice: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        storage: true,
        color: true,
        category: true,
        status: true,
        conditionGrade: true,
        cashPrice: true,
        installmentPrice: true,
        batteryHealth: true,
        shopWarrantyDays: true,
        accessoriesIncluded: true,
        cosmeticNotes: true,
        gallery: true,
        branch: { select: { name: true } },
      },
    });

    // narrowing hint แบบเดียวกับ get-installment-rates.tool: ถ้าลูกค้าระบุความจุ
    // และมีของตรงความจุนั้นจริง ค่อยแคบลง — ไม่งั้นคงชุดเดิมไว้ (ดีกว่าตอบว่าไม่มี)
    let candidates = rows;
    if (parsed.storage) {
      const bySize = rows.filter((r) => normalizeStorage(r.storage) === parsed.storage);
      if (bySize.length > 0) candidates = bySize;
    }
    if (parsed.color) {
      const byColor = candidates.filter((r) => (r.color ?? '').includes(parsed.color!));
      if (byColor.length > 0) candidates = byColor;
    }

    const priced = candidates.filter((r) => r.cashPrice != null && Number(r.cashPrice) > 0);
    const priceMissingCount = candidates.length - priced.length;

    const cap = input?.maxPriceThb;
    const inBudget =
      typeof cap === 'number' && Number.isFinite(cap)
        ? priced.filter((r) => Number(r.cashPrice) <= cap)
        : priced;

    const base = shopBaseUrl();
    const groups = new Map<string, SearchProductGroup>();
    for (const r of inBudget) {
      const condition = r.conditionGrade && r.conditionGrade.trim() ? r.conditionGrade : 'NEW';
      const storage = r.storage ? normalizeStorage(r.storage) : null;
      const key = `${r.brand}|${r.model}|${storage ?? ''}|${condition}`;
      const priceThb = Number(r.cashPrice);
      const unit: SearchProductUnit = {
        id: r.id,
        priceThb,
        installmentPriceThb: r.installmentPrice != null ? Number(r.installmentPrice) : null,
        color: r.color ?? null,
        batteryHealth: r.batteryHealth ?? null,
        shopWarrantyDays: r.shopWarrantyDays ?? null,
        accessories: Array.isArray(r.accessoriesIncluded)
          ? (r.accessoriesIncluded as unknown[]).map((a) => String(a))
          : null,
        cosmeticNotes: r.cosmeticNotes ?? null,
        branchName: r.branch?.name ?? null,
        // ⚠️ ห้ามใช้ Product.photos — เป็น base64 data URL ส่งเข้า LINE/FB ไม่ได้
        photoAvailable: r.gallery.length > 0,
        photoUrl: r.gallery[0] ?? null,
        webUrl: base ? `${base}/products/${r.id}` : null,
        reserved: r.status === 'RESERVED',
        ...(r.status === 'RESERVED' ? { reservedNote: RESERVED_NOTE } : {}),
      };

      const g = groups.get(key);
      if (g) {
        g.unitCount += 1;
        g.minPrice = Math.min(g.minPrice, priceThb);
        g.maxPrice = Math.max(g.maxPrice, priceThb);
        // นับ RESERVED ก่อน slice (I2) — g.units ยังไม่ถูกตัดตอนนี้ แต่ reservedCount
        // ต้องรอด แม้ตอน sort+slice ท้ายฟังก์ชันจะตัด unit ตัวนี้ทิ้งจาก units[] ก็ตาม
        if (r.status === 'RESERVED') g.reservedCount += 1;
        g.units.push(unit);
      } else {
        groups.set(key, {
          brand: r.brand,
          model: r.model,
          storage,
          condition,
          unitCount: 1,
          minPrice: priceThb,
          maxPrice: priceThb,
          reservedCount: r.status === 'RESERVED' ? 1 : 0,
          units: [unit],
        });
      }
    }

    const sorted = [...groups.values()]
      .map((g) => ({
        ...g,
        units: g.units
          // เครื่องพร้อมขายมาก่อนเครื่องที่ติดจองเสมอ แล้วค่อยเรียงราคาถูก→แพง
          .sort((a, b) => Number(a.reserved) - Number(b.reserved) || a.priceThb - b.priceThb)
          .slice(0, MAX_UNITS_PER_GROUP),
      }))
      .sort((a, b) => a.minPrice - b.minPrice)
      .slice(0, MAX_GROUPS);

    return {
      query: { brand: parsed.brand, model: parsed.model, storage: parsed.storage, color: parsed.color },
      totalMatches: candidates.length,
      priceMissingCount,
      groups: sorted,
    };
  }
}
