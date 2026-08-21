import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ด่านเดียวของคำถาม "เครื่องนี้เข้า IN_STOCK ได้หรือยัง" + รูป AuditLog ของการเข้าคลัง
 *
 * `IN_STOCK` = "ขายที่ POS ได้ทันที" (`sale-writer.service.ts` รับเฉพาะสถานะนี้) ⇒ ทุก
 * ประตูที่พาเครื่องเข้าสถานะนี้ต้องผ่านกติกาชุดเดียวกัน ไม่งั้นประตูที่หลวมที่สุดคือกติกาจริง
 *
 * ผู้ใช้ helper นี้ (ครบทุกประตูที่ "คนกด" ได้ ณ 2026-08-21):
 * 1. `ProductsService.returnToStock` — ปุ่ม "นำเข้าคลังพร้อมขาย" (บังคับ **ยืนยันราคา**)
 * 2. `ProductsService.update`        — PATCH เปลี่ยนสถานะด้วยมือ (บังคับ **มีราคา**)
 * 3. `ProductPhotosService.completePhotos` — ยืนยันรูป 6 มุม `PHOTO_PENDING → IN_STOCK`
 *
 * ประตูที่เหลือเป็น flow อัตโนมัติของสายรับของใหม่ (`po-receiving`) และการปรับสต็อก
 * (`stock-adjustments` reason `FOUND` — มี 4-eyes + แถวหลักฐานของตัวเอง) ดูหัวข้อ
 * "carry" ในรายงาน Phase 5 — อย่าเขียนคอมเมนต์อ้างว่า "ทุกเส้นทาง" ถ้ายังไม่ได้ต่อครบ
 */

export const ENTER_STOCK_AUDIT_ACTION = 'PRODUCT_RETURNED_TO_STOCK';

/** ช่องทางที่พาเครื่องเข้าคลัง — ลงใน AuditLog เพื่อแยกแยะตอนตรวจย้อนหลัง */
export type EnterStockVia = 'BUTTON' | 'PATCH' | 'PHOTO_COMPLETE';

export interface EnterStockProduct {
  cashPrice?: Prisma.Decimal | string | number | null;
  installmentPrice?: Prisma.Decimal | string | number | null;
  prices?: Array<{ amount: Prisma.Decimal | string | number; deletedAt?: Date | null }>;
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
 * เครื่องนี้มีราคาขายแล้วหรือยัง
 *
 * ต่างจาก `evaluateReadiness` (product-readiness.util.ts) ที่ถามว่า "พร้อม**ขึ้นเว็บ**ไหม"
 * — อันนั้นบังคับ cashPrice, gallery, แบรนด์ Apple, isOnlineVisible. ที่นี่ถามแค่ว่า
 * "ขายหน้าร้านได้ไหม" ⇒ ราคาเงินสด **หรือ** ราคาผ่อนก็พอ และยอมรับ `prices[]` เป็น
 * fallback สำหรับเครื่องเก่าที่ตั้งราคาไว้ก่อนยุคคอลัมน์ (B0 write-through)
 *
 * กรองแถว `prices[]` ที่ถูก soft-delete ออก — `productInclude.prices` ไม่กรอง
 * `deletedAt: null` ให้ (เป็น include ที่ผู้อ่านหลายตัวใช้ร่วมกัน) ⇒ ต้องกรองที่นี่
 */
export function hasSellingPrice(product: EnterStockProduct): boolean {
  if (isPositiveAmount(product.cashPrice) || isPositiveAmount(product.installmentPrice)) {
    return true;
  }
  return (product.prices ?? []).some((r) => !r.deletedAt && isPositiveAmount(r.amount));
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

const amountText = (v: Prisma.Decimal | string | number | null | undefined): string | null =>
  v === null || v === undefined || v === '' ? null : v.toString();

/**
 * รูป AuditLog เดียวของ "เครื่องเข้าคลัง" — ทุกประตูใช้ payload หน้าตาเดียวกัน
 * (บันทึกราคาเก่า→ใหม่เสมอ ไม่ว่าประตูไหน ⇒ ตรวจย้อนได้ว่าเครื่องไหนเข้าคลังโดยไม่มีการ
 * ยืนยันราคา: `newValue.via !== 'BUTTON'` แต่ราคาไม่ขยับ)
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
