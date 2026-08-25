import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | number | string;

/**
 * อัตราค่าคอมสำรอง **ค่าตั้งต้นสุดท้าย** เมื่อไม่มีทั้งค่าในสัญญาและค่าใน config.
 *
 * `config.util.ts` ใช้ค่านี้เป็น `DEFAULTS.storeCommissionPct` ⇒ แหล่งเดียวกัน
 * เลื่อนออกจากกันไม่ได้.
 *
 * ## ลำดับการหาอัตรา (คำวินิจฉัยผู้สอบ C2 รอบ 2, 2026-08-25)
 *
 * ผู้สอบตอบว่า *"มีต่อไปทุกสัญญาที่เป็น FINANCE ของเราเอง / ตั้งอัตราสำรอง (แก้ไขได้)"*
 * ⇒ อัตราต้อง**แก้ได้** ไม่ใช่ตรึงในโค้ด. ลำดับที่ระบบใช้:
 *
 *   1. `Contract.storeCommission` — ตัวเลขที่ตกลงกับหน้าร้านจริง (ชนะเสมอ)
 *   2. `InterestConfig.storeCommissionPct` / SystemConfig `store_commission_pct`
 *      — resolve **ครั้งเดียวตอนเปิดสัญญา** แล้ว **เขียนกลับลง `Contract.storeCommission`**
 *   3. ค่านี้ — ตาข่ายสุดท้ายสำหรับสัญญาเก่าที่ไม่เคยผ่านขั้น (2)
 *
 * ## ⚠️ ทำไมเทมเพลต JE ถึงไม่อ่าน config เอง
 *
 * ถ้าเทมเพลตอ่าน config ตอนโพสต์ การเปลี่ยนอัตราวันหลังจะทำให้การคำนวณซ้ำของสัญญาเก่า
 * ได้ตัวเลขคนละตัวกับที่ลงบัญชีไว้ **และที่แย่กว่านั้น**: ถ้าอัตราถูกแก้ระหว่างที่ 1A
 * (ฝั่ง FINANCE) กับ `ShopInventoryTransferTemplate` (ฝั่ง SHOP) โพสต์คนละจังหวะ
 * สองสมุดจะได้ค่าคอมคนละตัว = **บั๊ก `COMMISSION_ONLY_GAP` ที่เพิ่งปิดไปกลับมาทันที**
 *
 * จึง resolve ครั้งเดียวตอน activate แล้ว persist — ทุกผู้อ่านหลังจากนั้นเห็นเลขเดียวกัน
 * และ replay ได้ผลเดิมเสมอ
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
  /**
   * อัตราสำรองที่ resolve มาจาก config แล้ว (เช่น `loadInstallmentConfig().storeCommissionPct`).
   * ไม่ส่ง = ใช้ค่าตั้งต้นสุดท้าย `STORE_COMMISSION_FALLBACK_RATE`.
   *
   * **ฟังก์ชันนี้เป็น pure/sync โดยตั้งใจ** — ผู้เรียกที่อ่าน config ได้ (service layer)
   * เป็นคนอ่านแล้วส่งเข้ามา ส่วนเทมเพลต JE เรียกโดยไม่ส่ง เพราะถึงตอนนั้น
   * `Contract.storeCommission` ควรถูกเขียนไว้แล้วตั้งแต่ activate
   */
  fallbackRate?: DecimalInput | null;
}): Prisma.Decimal {
  // `!= null` ไม่ใช่ truthiness — ค่าคอม 0 ที่ระบุมาจริงต้องแปลว่า "ศูนย์" ไม่ใช่ "ไม่ระบุ"
  if (input.storeCommission != null) {
    return new Prisma.Decimal(input.storeCommission.toString());
  }
  const rate =
    input.fallbackRate != null
      ? new Prisma.Decimal(input.fallbackRate.toString())
      : new Prisma.Decimal(STORE_COMMISSION_FALLBACK_RATE);
  return new Prisma.Decimal(input.financedAmount.toString())
    .times(rate)
    .toDecimalPlaces(2);
}
