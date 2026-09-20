import { BadRequestException } from '@nestjs/common';

/** หมวดเดียวที่เป็นของแถมได้ (คำตัดสินเจ้าของ 2026-09-20) */
export const BUNDLE_CATEGORY = 'ACCESSORY';

/**
 * ของแถม = อุปกรณ์เสริมเท่านั้น — เดิมช่องของแถมรับสินค้าพร้อมขายอะไรก็ได้
 * ⇒ กดแถมมือถือ/แท็บเล็ตทั้งเครื่องในราคา 0 บาทได้. หน้าจอกรองหมวดให้แล้ว ด่านนี้กันคนยิง API ตรง
 *
 * แหล่งเดียวของกติกา + ข้อความ — ใช้ทั้ง POS (`SaleWriterService.markBundleProductsSold`)
 * และสัญญาผ่อน (`reserveContractBundles`)
 */
export function assertBundleIsAccessory(products: { name: string; category: string }[]): void {
  const notAccessory = products.find((p) => p.category !== BUNDLE_CATEGORY);
  if (notAccessory) {
    throw new BadRequestException(
      `ของแถมเลือกได้เฉพาะสินค้าหมวดอุปกรณ์เสริม — "${notAccessory.name}" ไม่ใช่อุปกรณ์เสริม`,
    );
  }
}
