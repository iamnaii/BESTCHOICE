/**
 * วันขายของใบขายสด/ไฟแนนซ์นอก = ฐานกรอบ 7 วัน (PR 5): `shopWarrantyStartDate` ถูกตั้ง = เวลาขายโดย
 * `SaleWriterService.resolveSaleShopWarranty` และถูกตั้งใหม่ = วันส่งมอบตอนเปลี่ยนรุ่นเดิม ⇒ กรอบของ
 * เครื่องทดแทนนับใหม่เองโดยไม่ต้องมีคอลัมน์เพิ่ม · ใบที่ไม่มีนโยบายประกัน (start ว่าง) ใช้ createdAt
 */
export function saleSoldAt(
  sale: { shopWarrantyStartDate?: Date | null; createdAt: Date } | null | undefined,
): Date | null {
  if (!sale) return null;
  return sale.shopWarrantyStartDate ?? sale.createdAt;
}
