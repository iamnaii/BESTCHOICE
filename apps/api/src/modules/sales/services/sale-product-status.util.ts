import { ProductStatus, type SaleType } from '@prisma/client';

/**
 * สถานะที่ใบขายแต่ละแบบตั้งให้ **สินค้าหลัก** — `sale-writer.service.ts`: ขายสดตั้ง `SOLD_CASH`
 * (createCashSale) / ขายผ่านไฟแนนซ์ภายนอกตั้ง `SOLD_INSTALLMENT` (createExternalFinanceSale).
 * ผู้ใช้: ด่าน G5 ของ `SaleVoidService` และด่าน/การ flip เครื่องของเปลี่ยนรุ่นเดิมขายสด (PR 5) —
 * แผนที่เดียว ห้ามมีสำเนาที่สอง
 */
export const SALE_TYPE_PRODUCT_STATUS: Readonly<Record<'CASH' | 'EXTERNAL_FINANCE', ProductStatus>> = {
  CASH: ProductStatus.SOLD_CASH,
  EXTERNAL_FINANCE: ProductStatus.SOLD_INSTALLMENT,
};

/** null = ใบขายประเภทที่ไม่อยู่ในแผนที่ (INSTALLMENT ของเรา — เครื่องอยู่กับสัญญา ไม่ใช่ใบขาย) */
export function mainProductStatusFor(saleType: SaleType): ProductStatus | null {
  return saleType === 'CASH' || saleType === 'EXTERNAL_FINANCE'
    ? SALE_TYPE_PRODUCT_STATUS[saleType]
    : null;
}
