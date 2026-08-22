import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CASH_LABEL, INSTALLMENT_LABEL } from '../../utils/product-price-sync.util';

/**
 * ด่านเดียวของคำถาม "เครื่องนี้เข้า IN_STOCK ได้หรือยัง" + รูป AuditLog ของการเข้าคลัง
 *
 * `IN_STOCK` = "ขายที่ POS ได้ทันที" (`sale-writer.service.ts` รับเฉพาะสถานะนี้) ⇒ ทุก
 * ประตูที่พาเครื่องเข้าสถานะนี้ต้องผ่านกติกาชุดเดียวกัน ไม่งั้นประตูที่หลวมที่สุดคือกติกาจริง
 *
 * ผู้ใช้ helper นี้ = **ประตูที่คนกดเพื่อพาเครื่องเข้าคลัง** (ณ 2026-08-22):
 * 1. `ProductsService.returnToStock` — ปุ่ม "นำเข้าคลังพร้อมขาย" (บังคับ **ยืนยันราคา**)
 * 2. `ProductsService.update`        — PATCH เปลี่ยนสถานะด้วยมือ (บังคับ **มีราคา**)
 * 3. `ProductPhotosService.completePhotos` — ยืนยันรูป 6 มุม `PHOTO_PENDING → IN_STOCK`
 *    (soft gate: ไม่มีราคา = ไม่เลื่อนสถานะ ไม่ใช่ปฏิเสธงานทั้งใบ — ดู Minor 4 รอบ 3)
 *
 * ประตูที่ **ไม่** ผ่าน helper นี้โดยตั้งใจ (ครบทุกจุดที่เขียน `status: 'IN_STOCK'`
 * นอกเหนือจาก 3 ข้อบน — ตรวจซ้ำ 2026-08-22, fix round 4 Minor 3):
 * - `po-receiving` — สายรับ**ของใหม่** อัตโนมัติ (ตั้งราคาในใบเดียวกันอยู่แล้ว)
 * - `stock-adjustments` reason `FOUND` — มี allow-list ของตัวเอง (กู้ของหาย/ของเสีย
 *   เท่านั้น) + 4-eyes + แถว `StockAdjustment` เป็นหลักฐาน
 * - เส้นทาง **ยกเลิก** (`contract-cancellation.service.ts`,
 *   `contract-exchange-cancel.service.ts`) — เครื่องกลับมาพร้อมราคาของตัวเองและมี audit
 *   ของ flow นั้นเอง (เปิดไว้ถูกแล้ว ไม่ใช่ carry)
 * - **ปลดจอง** `RESERVED → IN_STOCK` (`stock-reservation.service.ts` `unreserve`,
 *   `contract-lifecycle.service.ts` ตอนยกเลิกสัญญาที่ยังจองอยู่) — benign โดยโครงสร้าง:
 *   เครื่องต้องเป็น `IN_STOCK` (มีราคาแล้ว) มาก่อนจึงจะถูกจองได้ การปลดจองคือคืนสภาพเดิม
 *   ไม่ใช่การพาเครื่องใหม่เข้าคลัง
 * - **นำเข้าข้อมูลเก่า** `tooltify-stock-parser.ts` (ใช้โดย `import-tooltify-stock.cli`)
 *   — งาน migration ที่อ่านราคามาจากชีตในแถวเดียวกัน ไม่ใช่ประตูที่คนกดในระบบ
 */

export const ENTER_STOCK_AUDIT_ACTION = 'PRODUCT_RETURNED_TO_STOCK';

/** ช่องทางที่พาเครื่องเข้าคลัง — ลงใน AuditLog เพื่อแยกแยะตอนตรวจย้อนหลัง */
export type EnterStockVia = 'BUTTON' | 'PATCH' | 'PHOTO_COMPLETE';

/**
 * แถว `ProductPrice` เท่าที่ด่านนี้ต้องรู้ — `label`/`isDefault` เป็น optional เพราะ
 * ผู้เรียกบางรายเลือกมาแค่ `{ amount, deletedAt }` (พอสำหรับ `hasSellingPrice`)
 */
export interface EnterStockPriceRow {
  label?: string;
  amount: Prisma.Decimal | string | number;
  isDefault?: boolean;
  deletedAt?: Date | null;
}

export interface EnterStockProduct {
  cashPrice?: Prisma.Decimal | string | number | null;
  installmentPrice?: Prisma.Decimal | string | number | null;
  prices?: EnterStockPriceRow[];
}

/** ค่าที่ "เป็นราคาจริง" — null/ว่าง/0/ติดลบ ถือว่ายังไม่ได้ตั้งราคา */
export function isPositiveAmount(
  v: Prisma.Decimal | string | number | null | undefined,
): boolean {
  if (v === null || v === undefined || v === '') return false;
  return new Prisma.Decimal(v.toString()).gt(0);
}

/** number จาก DTO → Decimal เมื่อเป็นค่าบวกจริงเท่านั้น (ไม่งั้น null) */
export function positiveDecimalOrNull(v: number | null | undefined): Prisma.Decimal | null {
  return isPositiveAmount(v) ? new Prisma.Decimal(v as number) : null;
}

/**
 * แถวที่ยังมีผลจริง (ไม่ถูก soft-delete)
 *
 * **เหตุผลอัปเดต (final review M-3):** `productInclude.prices` กรอง `deletedAt: null`
 * ให้แล้วตั้งแต่ fix round 4 (Important 2 ก — กรองที่ต้นทางแทนไล่กรองรายผู้อ่าน) ⇒
 * ผู้เรียกทาง `ProductsService` ไม่ต้องพึ่งชั้นนี้อีก. ที่ยังต้องมีเพราะ **ผู้เรียกที่
 * `select` ชุดของตัวเอง**: `ProductPhotosService.completePhotos`
 * (`prices: { select: { amount, deletedAt } }` — ไม่มี `where`) ⇒ แถวที่ถูกลบยังไหลเข้ามา
 * ที่นี่ได้จริง. defense-in-depth ของประตูอื่นด้วย — อย่าลบทิ้งเพราะ "ต้นทางกรองแล้ว"
 */
function liveRows(product: EnterStockProduct): EnterStockPriceRow[] {
  return (product.prices ?? []).filter((r) => !r.deletedAt);
}

/**
 * เครื่องนี้มีราคาขายแล้วหรือยัง
 *
 * ต่างจาก `evaluateReadiness` (product-readiness.util.ts) ที่ถามว่า "พร้อม**ขึ้นเว็บ**ไหม"
 * — อันนั้นบังคับ cashPrice, gallery, แบรนด์ Apple, isOnlineVisible. ที่นี่ถามแค่ว่า
 * "ขายหน้าร้านได้ไหม" ⇒ ราคาเงินสด **หรือ** ราคาผ่อนก็พอ และยอมรับ `prices[]` เป็น
 * fallback สำหรับเครื่องเก่าที่ตั้งราคาไว้ก่อนยุคคอลัมน์ (B0 write-through)
 */
export function hasSellingPrice(product: EnterStockProduct): boolean {
  if (isPositiveAmount(product.cashPrice) || isPositiveAmount(product.installmentPrice)) {
    return true;
  }
  return liveRows(product).some((r) => isPositiveAmount(r.amount));
}

export const NO_PRICE_MESSAGE =
  'ยังไม่ได้ตั้งราคาขายของเครื่องนี้ — ตั้งราคาขาย (เงินสด/ผ่อน) ก่อนจึงจะนำเข้าคลังพร้อมขายได้ ' +
  '(เครื่องที่อยู่ในคลังต้องขายที่ POS ได้ทันที)';

/** โยน `BadRequestException` เมื่อเครื่องยังไม่มีราคาขาย — ใช้ทุกประตูที่เข้า IN_STOCK */
export function assertSellableOnEnterStock(product: EnterStockProduct): void {
  if (!hasSellingPrice(product)) {
    throw new BadRequestException(NO_PRICE_MESSAGE);
  }
}

/** ราคาบวกที่ยังค้างอยู่บนเครื่องหลังการยืนยัน — แยกตามที่อยู่ของมัน */
export interface UnconfirmedPrices {
  /** คอลัมน์ `cashPrice`/`installmentPrice` ที่มีราคาเก่าแต่ไม่ถูกยืนยันมา */
  columns: string[];
  /** แถว `ProductPrice` ที่ `syncPriceRowsFromColumns` จะ **ไม่** ทับ ⇒ ราคาเก่ารอดต่อ */
  rows: string[];
  /**
   * Fix round 4 [Important 2 ข] — "ยืนยันราคาเงินสดเพิ่ม จะทับแถวที่ค้างอย่างน้อยหนึ่งแถว"
   *
   * ใช้เลือก **คำแนะนำที่ทำได้จริง**: รอบก่อนหน้าสั่งให้ "ลบหรือแก้แถวราคานั้น" ทุกกรณี
   * แต่ `ProductsPricingService.removePrice` เป็น soft delete ที่ปฏิเสธเมื่อเหลือแถวเดียว
   * (`'ต้องมีอย่างน้อย 1 ราคาขาย'`) ⇒ เคส headline (แถว default เดียวค้าง + ยืนยันเฉพาะ
   * ราคาผ่อน) ทำตามคำแนะนำแล้วตัน ทั้งที่ทางออกอยู่ในฟอร์มเดียวกันนี้เอง
   *
   * `undefined` (ผู้เรียกที่ประกอบ object เอง เช่นเทสต์ข้อความ) = ถือว่าทับไม่ได้
   */
  cashConfirmAbsorbs?: boolean;
}

const INSTALLMENT_PREFIX = 'ราคาผ่อน';

/**
 * ราคาบวกที่ค้างอยู่บนเครื่องแต่ **ไม่ถูกทับ** ด้วยราคาที่คนยืนยันมา
 *
 * Fix round 3 [Minor 3] — เดิมด่านนี้อ่านเฉพาะ **คอลัมน์** ขณะที่ `hasSellingPrice`
 * (ในไฟล์เดียวกัน) รู้จัก **แถว** ด้วย ⇒ asymmetry ที่เปิดช่องจริง: คอลัมน์ว่างทั้งคู่
 * แต่มีแถว `{15900, isDefault:true}` ค้าง (เกิดจาก PATCH `cashPrice: null` หรือ
 * `POST /products/:id/prices` ที่ตั้ง label เอง) → ยืนยันเฉพาะราคาผ่อน → ด่านผ่าน →
 * `syncPriceRowsFromColumns` ได้ `keepDefaultId = null` (มี default เดิมอยู่แล้ว) ⇒
 * แถว 15,900 ยังเป็น default ที่ POS/บอท (`isDefault take:1`) หยิบไปขาย
 *
 * การเลือก "แถวที่จะถูกทับ" **สะท้อน `syncPriceRowsFromColumns` ตรง ๆ** (label ตรงก่อน
 * แล้วค่อย default row ฝั่งเงินสด) — คำนวณบนแถวที่ยังไม่ถูกลบ **ทุกแถว** รวมแถวยอด 0
 * เพราะ sync เองก็เลือกเป้าหมายจากชุดนั้น (แถว "ราคาเงินสด" ยอด 0 จะดูดการทับไป
 * แล้วปล่อยแถว default ที่มียอดจริงรอดต่อ — ต้องรายงาน ไม่ใช่มองข้าม)
 */
export function unconfirmedLeftoverPrices(
  product: EnterStockProduct,
  confirmed: { cashPrice: Prisma.Decimal | null; installmentPrice: Prisma.Decimal | null },
): UnconfirmedPrices {
  const columns: string[] = [];
  if (!confirmed.cashPrice && isPositiveAmount(product.cashPrice)) {
    columns.push('ราคาเงินสดเดิม ' + product.cashPrice?.toString());
  }
  if (!confirmed.installmentPrice && isPositiveAmount(product.installmentPrice)) {
    columns.push('ราคาผ่อนเดิม ' + product.installmentPrice?.toString());
  }

  const rows = liveRows(product);
  // mirror ของ `syncPriceRowsFromColumns` phase 1 ฝั่งเงินสด (label ตรง → default row)
  const cashTargetIndex = (() => {
    const exact = rows.findIndex((r) => r.label === CASH_LABEL);
    if (exact >= 0) return exact;
    return rows.findIndex((r) => r.isDefault && !(r.label ?? '').startsWith(INSTALLMENT_PREFIX));
  })();

  const overwritten = new Set<number>();
  if (confirmed.cashPrice && cashTargetIndex >= 0) overwritten.add(cashTargetIndex);
  if (confirmed.installmentPrice) {
    const idx = rows.findIndex((r) => r.label === INSTALLMENT_LABEL);
    if (idx >= 0) overwritten.add(idx);
  }

  const leftoverIndexes = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => !overwritten.has(i) && isPositiveAmount(r.amount));

  // ยังไม่ได้ยืนยันเงินสด และแถวที่ค้างอยู่คือแถวที่การยืนยันเงินสดจะทับพอดี
  // ⇒ ทางออกอยู่ในฟอร์มเดียวกันนี้ ไม่ต้องส่งไปหน้าจัดการราคา (ซึ่งลบแถวสุดท้ายไม่ได้)
  const cashConfirmAbsorbs =
    !confirmed.cashPrice && leftoverIndexes.some(({ i }) => i === cashTargetIndex);

  return {
    columns,
    rows: leftoverIndexes.map(
      ({ r }) => 'แถวราคา "' + (r.label ?? '(ไม่มีชื่อ)') + '" ' + r.amount.toString(),
    ),
    cashConfirmAbsorbs,
  };
}

/**
 * ข้อความไทยของราคาที่ยังไม่ถูกยืนยัน — `null` เมื่อยืนยันครบ
 *
 * Fix round 3 [Important 2] — ข้อความต้องชี้ **ทางออกที่ทำได้จริงวันนี้** เท่านั้น
 * ของเดิมบอกให้ไป "แก้ราคาขาย" เพื่อ *ล้าง* ราคาช่องนั้น ทั้งที่ฟอร์มนั้นล้างคอลัมน์
 * ไม่ได้เลย (ช่องว่าง ⇒ `undefined` ⇒ ไม่แตะคอลัมน์; และ `PriceManagementModal`
 * ปฏิเสธ `<= 0`) ⇒ ส่งผู้ใช้ไปชนกำแพง. ความสามารถ "ล้างราคา" เป็น carry → Task 6
 * (ต้องยุ่งกับแถว `ProductPrice`/แถว default ซึ่งเป็นกติกาของหน้าแก้ราคา = กติกาชุดที่สอง)
 *
 * Fix round 4 [Important 2 ข] — ส่วน **แถว** ก็ชี้ผิดเหมือนกัน: ของเดิมสั่งให้ "ลบหรือ
 * แก้แถวราคานั้น" ที่หน้า "จัดการราคา" ทุกกรณี แต่ `removePrice` เป็น soft delete ที่
 * ปฏิเสธเมื่อเหลือแถวเดียว (`'ต้องมีอย่างน้อย 1 ราคาขาย'`) ⇒ เคส headline (แถว default
 * เดียวค้าง เพราะยืนยันมาแต่ราคาผ่อน) ทำตามแล้วตัน. ตอนนี้แยกสองทาง:
 * - `cashConfirmAbsorbs` → บอกให้ยืนยัน "ราคาเงินสด" ในฟอร์มนี้เลย (sync จะทับแถวนั้นเอง)
 * - นอกนั้น → หน้า "จัดการราคา" ซึ่งแก้ยอดได้เสมอ และลบได้เมื่อเหลือมากกว่า 1 แถว
 */
export function unconfirmedPriceMessage(u: UnconfirmedPrices): string | null {
  const parts: string[] = [];
  if (u.columns.length > 0) {
    parts.push(
      u.columns.join(' และ ') +
        ' ยังค้างอยู่บนเครื่อง — ยืนยันราคาเดิมหรือพิมพ์ราคาใหม่ทับให้ครบทุกช่องก่อนนำเข้าคลัง ' +
        '(ช่องที่ไม่ได้ยืนยันจะยังเป็นราคาจากตอนขายครั้งก่อน และกลายเป็นราคาตั้งต้นที่ POS)',
    );
  }
  if (u.rows.length > 0) {
    parts.push(
      u.rows.join(' และ ') +
        ' ยังค้างอยู่ และราคาที่ยืนยันจะไม่ทับแถวนี้ — ' +
        (u.cashConfirmAbsorbs
          ? 'ยืนยัน "ราคาเงินสด" ในฟอร์มนี้ด้วย ราคาที่ยืนยันจะถูกเขียนทับลงแถวนั้นให้เอง'
          : 'แก้ยอดแถวนั้นให้เป็นราคาปัจจุบันที่หน้าสต็อก ปุ่ม "จัดการราคา" ก่อน ' +
            '(ลบแถวได้เมื่อเครื่องมีราคามากกว่า 1 แถว)') +
        ' (แถวราคาตั้งต้นคือค่าที่ POS/บอทหยิบไปขาย)',
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

const amountText = (v: Prisma.Decimal | string | number | null | undefined): string | null =>
  v === null || v === undefined || v === '' ? null : v.toString();

/**
 * รูป AuditLog เดียวของ "เครื่องเข้าคลัง" — ทุกประตูใช้ payload หน้าตาเดียวกัน
 * (บันทึกราคาเก่า→ใหม่เสมอ ไม่ว่าประตูไหน ⇒ ตรวจย้อนได้ว่าเครื่องไหนเข้าคลังโดยไม่มีการ
 * ยืนยันราคา: `newValue.via !== 'BUTTON'` แต่ราคาใน `newValue` เท่ากับ `oldValue`)
 */
export function enterStockAuditData(input: {
  productId: string;
  userId: string;
  fromStatus: string;
  via: EnterStockVia;
  before: EnterStockProduct;
  after?: { cashPrice?: Prisma.Decimal | null; installmentPrice?: Prisma.Decimal | null };
  note?: string | null;
}) {
  const beforeCash = amountText(input.before.cashPrice);
  const beforeInstallment = amountText(input.before.installmentPrice);
  return {
    userId: input.userId,
    action: ENTER_STOCK_AUDIT_ACTION,
    entity: 'product',
    entityId: input.productId,
    oldValue: {
      status: input.fromStatus,
      cashPrice: beforeCash,
      installmentPrice: beforeInstallment,
    },
    newValue: {
      status: 'IN_STOCK',
      via: input.via,
      // ไม่ส่งค่าใหม่มา = ประตูนั้นไม่ได้แตะราคา → ราคาหลังเข้าคลัง = ราคาเดิม
      cashPrice: amountText(input.after?.cashPrice) ?? beforeCash,
      installmentPrice: amountText(input.after?.installmentPrice) ?? beforeInstallment,
      note: input.note ?? null,
    },
  };
}
