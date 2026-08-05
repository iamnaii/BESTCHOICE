import { Prisma } from '@prisma/client';

export const SHOP_BRAND = 'Apple';
export const SHOP_PHONE_CATEGORIES = ['PHONE_NEW', 'PHONE_USED'] as const;
export const DEMO_NAME_PREFIX = '[DEMO]';
/**
 * ชุดเกรดที่ระบบยอมรับ — ใช้ทั้งใน where fragment และ checklist เพื่อให้ตัดสินเหมือนกัน
 * (ตรงกับ InspectionsService.calculateGrade / repossessions validGrades / DTO @IsIn)
 */
export const VALID_CONDITION_GRADES = ['A', 'B', 'C', 'D'] as const;

export interface ProductReadinessOptions {
  requireInStock?: boolean;
  /**
   * true = กรอง [DEMO] ออก (`NOT: { name: { startsWith: DEMO_NAME_PREFIX } }`).
   * **Default `false` = ไม่กรอง** (ยังโชว์ [DEMO]) — owner decision (2026-08):
   * prod วันนี้มีแต่สินค้า [DEMO] ที่ข้อมูลครบ ถ้ากรอง unconditional เว็บจะว่าง
   * 0 สินค้าทันทีหลัง deploy จนกว่า owner จะกรอกสินค้าจริงและเปิดวันเปิดร้าน
   *
   * util นี้เป็น **pure function — ห้ามอ่าน SystemConfig เอง**. ผู้เรียก (Task 11:
   * shop-catalog / reserve / bot) เป็นคนอ่านค่า SystemConfig flag
   * `shop_hide_demo_products` แล้ว "แปล" เป็น boolean นี้ก่อนส่งเข้ามา —
   * `excludeDemo: (await readFlag('shop_hide_demo_products')) === 'true'`
   */
  excludeDemo?: boolean;
}

/**
 * B0 §2.3 — เงื่อนไข "ข้อมูลครบพอขึ้นเว็บ" ชุดเดียวของทั้งระบบ
 *
 * คืน fragment ที่ **ใช้คีย์ `AND` อย่างเดียวที่ระดับบนสุด** — จำเป็น เพราะ
 * `ShopCatalogService.listGroupedByModel` assign `where.OR` เองสำหรับ search
 * (shop-catalog.service.ts:96-99) ถ้า fragment ใช้ `OR` ระดับบนสุดจะโดนทับเงียบๆ
 *
 * `requireInStock:false` ใช้เฉพาะ head query ของ getProductDetail — เครื่องที่
 * ขายแล้วต้องยังเปิดหน้ารุ่นได้ (permalink; spec §0)
 *
 * `excludeDemo` default `false` (โชว์ [DEMO]) — ดู `ProductReadinessOptions` doc
 */
export function productReadinessWhere(opts?: ProductReadinessOptions): Prisma.ProductWhereInput {
  const requireInStock = opts?.requireInStock ?? true;
  const excludeDemo = opts?.excludeDemo ?? false;
  const and: Prisma.ProductWhereInput[] = [
    { deletedAt: null },
    { isOnlineVisible: true },
    ...(requireInStock ? [{ status: 'IN_STOCK' } as Prisma.ProductWhereInput] : []),
    { brand: SHOP_BRAND },
    { category: { in: [...SHOP_PHONE_CATEGORIES] } },
    { cashPrice: { gt: 0 } },
    { gallery: { isEmpty: false } },
    // ไม่ผูกกับ NODE_ENV — QA local ต้องเห็นพฤติกรรมเดียวกับ prod; ผูกกับ
    // excludeDemo (ผู้เรียกอ่าน SystemConfig flag `shop_hide_demo_products` มาแล้ว) แทน
    ...(excludeDemo
      ? [{ NOT: { name: { startsWith: DEMO_NAME_PREFIX } } } as Prisma.ProductWhereInput]
      : []),
    {
      // ⚠️ ต้องใช้ชุดค่าเดียวกับ evaluateReadiness — `{ not: '' }` ปล่อยเกรดที่เป็น
      // ช่องว่างเดียวผ่าน (ขึ้นเว็บได้) ทั้งที่ checklist บอกว่ายังไม่พร้อม
      OR: [
        { category: { not: 'PHONE_USED' } },
        { conditionGrade: { in: [...VALID_CONDITION_GRADES] } },
      ],
    },
  ];
  return { AND: and };
}

export interface ReadinessProductShape {
  name: string;
  brand: string;
  category: string;
  status: string;
  cashPrice: Prisma.Decimal | string | null;
  gallery: string[];
  conditionGrade: string | null;
  isOnlineVisible: boolean;
  deletedAt: Date | null;
}

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
  /**
   * true ถ้าชื่อขึ้นต้น [DEMO] — **non-blocking, ไม่ทำให้ `ready` เป็น false**.
   * evaluateReadiness เป็น pure function ไม่รู้จัก SystemConfig flag
   * `shop_hide_demo_products` (ผู้เรียก/where fragment เป็นคนตัดสินว่าจะกรองไหม
   * ผ่าน `productReadinessWhere({ excludeDemo })`) — field นี้มีไว้ให้หน้า admin
   * (B1) โชว์ป้ายเตือน "สินค้าตัวอย่าง" เฉยๆ
   */
  isDemo: boolean;
}

/** checklist รายข้อสำหรับหน้าสินค้า admin (B1 กิน endpoint นี้) */
export function evaluateReadiness(p: ReadinessProductShape): ReadinessResult {
  const cash = p.cashPrice != null ? Number(p.cashPrice) : 0;
  const isUsed = p.category === 'PHONE_USED';
  const inShopGate =
    p.brand === SHOP_BRAND &&
    (SHOP_PHONE_CATEGORIES as readonly string[]).includes(p.category);

  const checks: ReadinessCheck[] = [
    {
      key: 'notDeleted',
      label: 'ยังไม่ถูกลบ',
      ok: p.deletedAt == null,
    },
    {
      key: 'shopGate',
      label: 'อยู่ในหมวดที่เว็บขาย',
      ok: inShopGate,
      hint: inShopGate ? undefined : 'เว็บขายเฉพาะ iPhone (มือ 1 / มือ 2) — สินค้านี้จะไม่ขึ้นเว็บ',
    },
    {
      key: 'inStock',
      label: 'อยู่ในสต็อก',
      ok: p.status === 'IN_STOCK',
      hint: p.status === 'IN_STOCK' ? undefined : `สถานะปัจจุบัน: ${p.status}`,
    },
    {
      key: 'cashPrice',
      label: 'มีราคาเงินสด',
      ok: cash > 0,
      hint: cash > 0 ? undefined : 'กรอกราคาเงินสดในส่วนราคา หรือกรอกตารางราคากลางให้ครบ',
    },
    {
      key: 'gallery',
      label: 'มีรูปขึ้นเว็บอย่างน้อย 1 รูป',
      ok: p.gallery.length > 0,
      hint: p.gallery.length > 0 ? undefined : 'เลือกรูปจากรูปสินค้าในระบบมาเป็นรูปขึ้นเว็บ',
    },
    {
      key: 'conditionGrade',
      label: 'มีเกรดเครื่อง (เฉพาะมือสอง)',
      // ชุดเดียวกับ where fragment เป๊ะ — ห้ามใช้ `.trim().length > 0` (จะยอมรับค่านอกชุด
      // และเกรดช่องว่างจะตัดสินไม่ตรงกับ DB)
      ok:
        !isUsed ||
        (VALID_CONDITION_GRADES as readonly string[]).includes(p.conditionGrade ?? ''),
      hint: !isUsed ? 'ไม่บังคับสำหรับเครื่องมือ 1' : undefined,
    },
    {
      key: 'isOnlineVisible',
      label: 'เปิดแสดงบนเว็บ',
      ok: p.isOnlineVisible === true,
      hint: p.isOnlineVisible ? undefined : 'ถูกปิดจากเว็บด้วยมือ — เปิดได้ที่สวิตช์แสดงบนเว็บ',
    },
    {
      // Non-blocking note (owner decision 2026-08): [DEMO] no longer blocks
      // readiness — `ok` is always true. Real gating (if any) happens at the
      // where-fragment level via `excludeDemo`, driven by SystemConfig flag
      // `shop_hide_demo_products` that the CALLER reads (this fn stays pure).
      key: 'isDemo',
      label: 'สินค้าตัวอย่าง [DEMO]',
      ok: true,
      hint: p.name.startsWith(DEMO_NAME_PREFIX)
        ? 'สินค้านี้เป็นตัวอย่าง [DEMO] — จะถูกกรองออกจากเว็บเมื่อเปิดสวิตช์ "ซ่อนสินค้าตัวอย่าง"'
        : undefined,
    },
  ];

  return {
    ready: checks.every((c) => c.ok),
    checks,
    isDemo: p.name.startsWith(DEMO_NAME_PREFIX),
  };
}
