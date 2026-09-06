import { ProductCategory } from '@prisma/client';
import { isAccessoryProductCode } from '../../../utils/accessory-type.util';

/**
 * Builds the display name for a product created from a PO item.
 *
 * Extracted VERBATIM from the name-building block in
 * PoReceivingService.goodsReceiving(). Pure helper — no prisma, no side effects.
 * (Originally shared with the legacy receive() path, retired in Purchasing v2 B0.)
 *
 * Accessory rules (owner-approved 2026-09-06 — mirrored by `itemLabel` on the web):
 *  - re-order of an EXISTING product: accessoryType holds the product code and `model`
 *    holds its exact name → the received unit keeps that name (stock groups by name)
 *  - ฟิล์ม / เคส fit a phone model: "type brand สำหรับ model"
 *  - ชุดชาร์จ (model = connector), หูฟัง, อื่นๆ: "type brand model"
 */
export function buildProductName(
  poItem: {
    accessoryType?: string | null;
    accessoryBrand?: string | null;
    model?: string | null;
    brand?: string | null;
    color?: string | null;
    storage?: string | null;
  },
  productCategory: ProductCategory,
): string {
  let productName: string;
  if (productCategory === 'ACCESSORY') {
    const type = poItem.accessoryType ?? '';
    const brand = poItem.accessoryBrand ?? '';
    const model = poItem.model ?? '';
    if (isAccessoryProductCode(type)) {
      productName = model || [type, brand].filter(Boolean).join(' ');
    } else if (type === 'ฟิล์ม' || type === 'เคส') {
      // "เคส Spigen สำหรับ iPhone 16 Pro, iPhone 16 Pro Max"
      const accParts = [type, brand].filter(Boolean).join(' ');
      productName = model ? `${accParts} สำหรับ ${model}` : accParts;
    } else {
      // "ชุดชาร์จ Anker Type-C" / "หูฟัง Apple AirPods Pro 2"
      productName = [type, brand, model].filter(Boolean).join(' ');
    }
  } else {
    const nameParts = [poItem.brand, poItem.model, poItem.color, poItem.storage].filter(Boolean);
    productName = nameParts.join(' ');
  }
  return productName;
}
