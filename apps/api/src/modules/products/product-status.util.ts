import { BadRequestException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';

/**
 * สถานะที่ระบบตั้ง/ปลดให้เองผ่าน flow เฉพาะ — ห้ามแก้มือผ่าน PATCH /products/:id
 * - RESERVED               ← จองสินค้า / ออเดอร์ออนไลน์ (ปลดผ่านยกเลิกจอง/ออเดอร์)
 * - SOLD_CASH / SOLD_RESELL ← บันทึกการขาย (แก้ผ่านยกเลิกการขาย)
 * - SOLD_INSTALLMENT       ← เปิดสัญญาผ่อน (แก้ผ่านยกเลิกสัญญา/ยึดเครื่อง/เปลี่ยนเครื่อง)
 * - REPOSSESSED            ← flow ยึดเครื่อง (กลับเข้าสต็อกผ่าน refurbish/ตีราคาใหม่)
 *
 * เปลี่ยนสถานะพวกนี้ตรง ๆ จะทำให้สต็อก/สัญญา/บัญชีไม่ตรงกับความจริง
 * (เช่น ปลด SOLD_INSTALLMENT เป็น IN_STOCK ทั้งที่สัญญายังถือเครื่องอยู่)
 */
export const SYSTEM_MANAGED_STATUSES: ReadonlySet<ProductStatus> = new Set([
  ProductStatus.RESERVED,
  ProductStatus.SOLD_CASH,
  ProductStatus.SOLD_INSTALLMENT,
  ProductStatus.SOLD_RESELL,
  ProductStatus.REPOSSESSED,
]);

/**
 * Transition ที่ห้ามแก้มือ "เฉพาะคู่" — แคบกว่า `SYSTEM_MANAGED_STATUSES` โดยตั้งใจ
 *
 * REFURBISHED → IN_STOCK (Phase 5 Task 3): เครื่องมือสองที่รับคืนต้องผ่านปุ่ม
 * "นำเข้าคลังพร้อมขาย" (`POST /products/:id/return-to-stock`) เพราะนั่นคือจังหวะที่
 * เครื่องกลายเป็นของขายได้จริงที่ POS (`sale-writer` รับเฉพาะ IN_STOCK) — ต้องมี
 * AuditLog ว่าใครเป็นคนตัดสิน + ด่านราคาขาย
 *
 * ทำไมไม่ยัด REFURBISHED เข้า `SYSTEM_MANAGED_STATUSES` ทั้งสถานะ: flow ระบบ
 * **ตั้ง** REFURBISHED (ยึดเครื่อง `markReadyForSale` / เปลี่ยนเครื่อง A.4) แต่ไม่มี
 * flow ไหน **ปลด** มันเลย ⇒ เหมารวมจะบล็อกทั้ง REFURBISHED → DAMAGED
 * (ตรวจแล้วเจอเสียเพิ่ม) และ DAMAGED → REFURBISHED (ซ่อมเสร็จ) ซึ่งไม่มีเส้นทาง
 * อื่นรองรับ = เครื่องค้างสถานะถาวร
 */
const MANUAL_TRANSITION_DENY: ReadonlyArray<{
  from: ProductStatus;
  to: ProductStatus;
  message: string;
}> = [
  {
    from: ProductStatus.REFURBISHED,
    to: ProductStatus.IN_STOCK,
    message:
      'เครื่องมือสองที่รับคืนต้องกดปุ่ม "นำเข้าคลังพร้อมขาย" ที่หน้ารายละเอียดสินค้า ' +
      'ไม่ใช่แก้สถานะตรง — ปุ่มนั้นตรวจว่ามีราคาขายแล้วและบันทึกว่าใครเป็นคนยืนยัน',
  },
];

const ALL_STATUSES = new Set<string>(Object.values(ProductStatus));

/** ป้ายไทยสั้น ๆ สำหรับข้อความ error (ไม่ต้องครบทุกสถานะ — เฉพาะที่โผล่ใน error ได้) */
const THAI: Partial<Record<ProductStatus, string>> = {
  [ProductStatus.RESERVED]: 'ติดจอง',
  [ProductStatus.SOLD_CASH]: 'ขายสดแล้ว',
  [ProductStatus.SOLD_INSTALLMENT]: 'ขายผ่อนแล้ว',
  [ProductStatus.SOLD_RESELL]: 'ขายต่อแล้ว',
  [ProductStatus.REPOSSESSED]: 'ยึดเครื่องแล้ว',
};

/** `STATUS (ป้ายไทย)` สำหรับข้อความ error — ใช้ร่วมกับ guard ลบสินค้าใน ProductsService */
export function productStatusLabel(s: ProductStatus): string {
  const th = THAI[s];
  return th ? `${s} (${th})` : s;
}

/**
 * กันแก้สถานะข้าม lifecycle จากหน้าแก้ไขสินค้า (PATCH /products/:id)
 * โยน BadRequestException เมื่อ:
 * - ค่าที่ส่งมาไม่ใช่สถานะที่มีจริง
 * - สถานะปัจจุบันเป็นแบบระบบจัดการ (ขาย/จอง/ยึด) — ต้องแก้ผ่าน flow ของมัน
 * - สถานะปลายทางเป็นแบบระบบจัดการ — ระบบจะตั้งให้เองเมื่อทำรายการจริง
 * - คู่ transition อยู่ใน `MANUAL_TRANSITION_DENY` (มีปุ่ม/flow เฉพาะของมันแล้ว)
 * ส่งค่าเดิม (ไม่เปลี่ยน) ผ่านได้เสมอ
 */
export function assertManualStatusChangeAllowed(current: ProductStatus, next: string): void {
  if (!ALL_STATUSES.has(next)) {
    throw new BadRequestException(`สถานะ "${next}" ไม่มีในระบบ`);
  }
  const target = next as ProductStatus;
  if (target === current) return;

  const denied = MANUAL_TRANSITION_DENY.find((r) => r.from === current && r.to === target);
  if (denied) {
    throw new BadRequestException(denied.message);
  }

  if (SYSTEM_MANAGED_STATUSES.has(current)) {
    throw new BadRequestException(
      `สินค้าอยู่สถานะ ${productStatusLabel(current)} ซึ่งระบบจัดการผ่านรายการขาย/จอง/ยึดเครื่อง — ` +
        'แก้ผ่าน flow นั้นแทน (เช่น ยกเลิกจอง ยกเลิกสัญญา) ไม่ใช่แก้สถานะตรงจากหน้าสินค้า',
    );
  }
  if (SYSTEM_MANAGED_STATUSES.has(target)) {
    throw new BadRequestException(
      `เปลี่ยนเป็นสถานะ ${productStatusLabel(target)} ตรง ๆ ไม่ได้ — ระบบจะตั้งให้เองเมื่อบันทึกการขาย/จอง/ยึดเครื่องจริง`,
    );
  }
}
