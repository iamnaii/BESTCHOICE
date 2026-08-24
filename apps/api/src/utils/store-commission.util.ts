import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | number | string;

/**
 * อัตราค่าคอมสำรอง เมื่อสัญญาไม่ได้ระบุ `Contract.storeCommission` ไว้.
 *
 * **จงใจ hardcode ไม่อ่านจาก config** — ตัวเลขนี้ถูกใช้ตอน "ลงบัญชี" ซึ่งต้อง replay
 * ย้อนหลังได้เหมือนเดิมทุกครั้ง. ถ้าอ่านจาก SystemConfig แล้ววันหนึ่งเจ้าของแก้เป็น 5%
 * การคำนวณซ้ำของสัญญาเก่าจะได้ตัวเลขคนละตัวกับที่ลงบัญชีไว้จริง.
 *
 * ⚠️ ผู้สอบบัญชีตอบข้อ C1 (2026-08-24) ว่า "SHOP ต้องตั้งค่าคอมให้ตรง FINANCE"
 * — ตอบว่า *ต้องบันทึก* ไม่ได้ตอบว่า *10% เป็นตัวเลขที่ถูก*. คำถามที่ยังค้าง:
 * ควรเลิกมี fallback แล้วบังคับกรอกค่าคอมตอนเปิดสัญญาไปเลยหรือไม่ (ตอนนี้สองสมุด
 * ตรงกันที่ตัวเลขที่ไม่มีใครเลือก). ดู `docs/accounting/cpa-answers-2026-08-24.md` ข้อ C1
 */
export const STORE_COMMISSION_FALLBACK_RATE = '0.10';

/**
 * ค่าคอมที่หน้าร้านได้จาก FINANCE สำหรับสัญญาหนึ่งใบ — **แหล่งความจริงเดียว**.
 *
 * ระบุมา → ใช้ตามนั้น · ไม่ระบุ (null/undefined) → `financedAmount × 10%` ปัดทศนิยม 2 ตำแหน่ง
 *
 * ## ทำไมต้องมี helper ตัวนี้
 *
 * ก่อน 2026-08-24 สูตรนี้ถูกเขียนซ้ำ **4 ชุด** และ **สองสมุดไม่ตรงกัน**:
 *
 * | ไฟล์ | เดิมทำอะไร |
 * |---|---|
 * | `contract-activation-1a.template.ts` | `storeCommission ?? financed × 0.10` (FINANCE ตั้งเจ้าหนี้ 21-1102) |
 * | `contract-workflow.service.ts` | `storeCommission ? … : 0` ❌ (SHOP ตั้ง 0) |
 * | `contract-exchange.service.ts` | `storeCommission ? … : 0` ❌ (SHOP ตั้ง 0) |
 * | `exchange-plan.util.ts` | `financedAmount × 0.10` (คำนวณแผนผ่อน) |
 *
 * ⇒ สัญญาที่ไม่ระบุค่าคอม FINANCE ตั้งเจ้าหนี้ 10% แต่ SHOP ตั้งลูกหนี้ 0
 * = ค่าคอมโผล่สมุดเดียว (`COMMISSION_ONLY_GAP` ที่ reconcile cron รายเดือนรายงานอยู่)
 *
 * ผู้สอบบัญชีตอบข้อ C1 (2026-08-24): *"ทำไมต้องตั้ง เพราะเป็นรายได้ หน้าร้าน
 * S41-1201 รายได้ - ค่าคอมจาก FINANCE"* ⇒ ทั้งสองสมุดต้องใช้ตัวเลขเดียวกัน
 * ⇒ ทุกที่ที่ต้องรู้ "ค่าคอมของสัญญานี้เท่าไร" ให้เรียกฟังก์ชันนี้ **ห้ามเขียนสูตรซ้ำ**
 *
 * ## ⚠️ ที่ห้ามใช้
 *
 * **ราคารับซื้อเครื่องเก่า (buyback) ตอนเปลี่ยนเครื่อง** — `contract-exchange.service.ts`
 * มี fallback `buyback = request.buybackPrice ?? financed + commission` ซึ่งเป็น
 * **ราคาที่ตกลงซื้อขายจริง ไม่ใช่การอนุมานทางบัญชี**. ผู้สอบตัดสินเรื่อง *การลงบัญชี*
 * ค่าคอม ไม่ได้ตัดสินเรื่อง *ราคารับซื้อ* ⇒ เอา helper ตัวนี้ไปใส่ตรงนั้นจะทำให้ราคารับซื้อ
 * ของสัญญาที่ไม่ระบุค่าคอมขยับจาก `financed` เป็น `financed × 1.10` เงียบ ๆ แล้วไหลต่อไปที่
 * 11-2107 / S21-1104 และยอดหักกลบรอบจ่าย.
 */
export function resolveStoreCommission(input: {
  storeCommission: DecimalInput | null | undefined;
  financedAmount: DecimalInput;
}): Prisma.Decimal {
  // `!= null` ไม่ใช่ truthiness — ค่าคอม 0 ที่ระบุมาจริงต้องแปลว่า "ศูนย์" ไม่ใช่ "ไม่ระบุ"
  if (input.storeCommission != null) {
    return new Prisma.Decimal(input.storeCommission.toString());
  }
  return new Prisma.Decimal(input.financedAmount.toString())
    .times(STORE_COMMISSION_FALLBACK_RATE)
    .toDecimalPlaces(2);
}
