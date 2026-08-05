import { Prisma } from '@prisma/client';

export const SHOP_BRAND = 'Apple';
export const SHOP_PHONE_CATEGORIES = ['PHONE_NEW', 'PHONE_USED'] as const;
export const DEMO_NAME_PREFIX = '[DEMO]';
/**
 * ชุดเกรดที่ระบบยอมรับ — ใช้ทั้งใน where fragment และ checklist เพื่อให้ตัดสินเหมือนกัน
 * (ตรงกับ InspectionsService.calculateGrade / repossessions validGrades / DTO @IsIn)
 */
export const VALID_CONDITION_GRADES = ['A', 'B', 'C', 'D'] as const;

/**
 * B0 §2.3 — เงื่อนไข "ข้อมูลครบพอขึ้นเว็บ" ชุดเดียวของทั้งระบบ
 *
 * คืน fragment ที่ **ใช้คีย์ `AND` อย่างเดียวที่ระดับบนสุด** — จำเป็น เพราะ
 * `ShopCatalogService.listGroupedByModel` assign `where.OR` เองสำหรับ search
 * (shop-catalog.service.ts:96-99) ถ้า fragment ใช้ `OR` ระดับบนสุดจะโดนทับเงียบๆ
 *
 * `requireInStock:false` ใช้เฉพาะ head query ของ getProductDetail — เครื่องที่
 * ขายแล้วต้องยังเปิดหน้ารุ่นได้ (permalink; spec §0)
 */
export function productReadinessWhere(opts?: {
  requireInStock?: boolean;
}): Prisma.ProductWhereInput {
  const requireInStock = opts?.requireInStock ?? true;
  const and: Prisma.ProductWhereInput[] = [
    { deletedAt: null },
    { isOnlineVisible: true },
    ...(requireInStock ? [{ status: 'IN_STOCK' } as Prisma.ProductWhereInput] : []),
    { brand: SHOP_BRAND },
    { category: { in: [...SHOP_PHONE_CATEGORIES] } },
    { cashPrice: { gt: 0 } },
    { gallery: { isEmpty: false } },
    // ไม่ผูกกับ NODE_ENV — QA local ต้องเห็นพฤติกรรมเดียวกับ prod
    { NOT: { name: { startsWith: DEMO_NAME_PREFIX } } },
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
      key: 'notDemo',
      label: 'ไม่ใช่สินค้าตัวอย่าง [DEMO]',
      ok: !p.name.startsWith(DEMO_NAME_PREFIX),
    },
    {
      key: 'isOnlineVisible',
      label: 'เปิดแสดงบนเว็บ',
      ok: p.isOnlineVisible === true,
      hint: p.isOnlineVisible ? undefined : 'ถูกปิดจากเว็บด้วยมือ — เปิดได้ที่สวิตช์แสดงบนเว็บ',
    },
  ];

  return { ready: checks.every((c) => c.ok), checks };
}
