import { Prisma, ProductCategory } from '@prisma/client';
import { FINANCE_LABEL, syncPriceRowsFromColumns } from './product-price-sync.util';
import { findPricingTemplate, positiveDecimal, type TemplateMatchKey } from './pricing-template-match.util';

/** ช่องของเครื่องที่ใช้หาแถวราคากลาง */
export interface ProductTemplateFields {
  brand: string;
  model: string;
  storage: string | null;
  category: ProductCategory;
  deviceOrigin: 'THAI' | 'IMPORTED' | null;
  warrantyExpired: boolean | null;
  warrantyExpireDate: Date | null;
}

/** สรุปสถานะประกันของเครื่องสำหรับเลือกแถวราคากลาง — null = ไม่รู้ (ย้ายมาจาก products.service.ts) */
export function resolveHasWarranty(p: {
  category: string;
  warrantyExpired: boolean | null;
  warrantyExpireDate: Date | null;
}): boolean | null {
  if (p.category !== 'PHONE_USED') return false;
  if (p.warrantyExpired === true) return false;
  if (p.warrantyExpired === false) return true;
  if (p.warrantyExpireDate) return p.warrantyExpireDate.getTime() > Date.now();
  return null;
}

export function templateKeyOf(p: ProductTemplateFields): TemplateMatchKey {
  return {
    brand: p.brand,
    model: p.model,
    storage: p.storage,
    category: p.category,
    deviceOrigin: p.deviceOrigin,
    hasWarranty: resolveHasWarranty(p),
  };
}

/** ราคาขาย GFIN จากราคากลางของรุ่น (ราคาเต็ม) · ไม่มีแถว / ราคา ≤ 0 = null */
export async function templateFinancePrice(
  tx: Prisma.TransactionClient,
  key: TemplateMatchKey,
): Promise<Prisma.Decimal | null> {
  const template = await findPricingTemplate(tx, key);
  return positiveDecimal(template?.installmentFinancePrice);
}

/**
 * แถว "ราคาผ่อนไฟแนนซ์" ตามคอลัมน์ที่เพิ่งเขียน — มีราคา = upsert (ไม่เป็นค่าเริ่มต้น) ·
 * null = ลบแถวเดิมแบบ soft (ไม่ปล่อยราคาของตอนเป็นเครื่องใหม่ค้าง) · แถวที่เป็นค่าเริ่มต้นไม่แตะ
 */
export async function syncFinancePriceRow(
  tx: Prisma.TransactionClient,
  productId: string,
  price: Prisma.Decimal | null,
): Promise<void> {
  if (price) {
    await syncPriceRowsFromColumns(tx, productId, { financePrice: price });
    return;
  }
  await tx.productPrice.updateMany({
    where: { productId, label: FINANCE_LABEL, isDefault: false, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

/**
 * ขั้นเติมราคาขาย GFIN ตอนสร้างเครื่อง (ทุกทางเข้า — สเปคข้อ 3.2) แยกจากตัวเติมราคาเงินสด
 * เพราะตัวเติมเดิมหยุดเมื่อมีราคาเงินสดแล้ว · ไม่พบราคากลาง = ไม่เขียนอะไร · ต้องเรียกใน tx ของผู้เรียก
 */
export async function fillFinancePriceFromTemplate(
  tx: Prisma.TransactionClient,
  productId: string,
  key: TemplateMatchKey,
): Promise<Prisma.Decimal | null> {
  const price = await templateFinancePrice(tx, key);
  if (!price) return null;
  await tx.product.update({ where: { id: productId }, data: { financePrice: price } });
  await syncFinancePriceRow(tx, productId, price);
  return price;
}
