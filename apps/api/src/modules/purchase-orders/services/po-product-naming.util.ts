import { ProductCategory } from '@prisma/client';

/**
 * Builds the display name for a product created from a PO item.
 *
 * Extracted VERBATIM from the (previously duplicated) name-building block in
 * PoReceivingService.receive() and PoReceivingService.goodsReceiving(). Pure
 * helper — no prisma, no side effects. The two original blocks were identical
 * apart from inline comments, so sharing this preserves behavior byte-for-byte.
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
    const isCharger = poItem.accessoryType === 'ชุดชาร์จ';
    if (isCharger) {
      // Charger: "ชุดชาร์จ Anker Type-C" (model = connector type)
      productName = [poItem.accessoryType, poItem.accessoryBrand, poItem.model].filter(Boolean).join(' ');
    } else {
      // Other accessories: "เคส Spigen สำหรับ iPhone 16 Pro, iPhone 16 Pro Max"
      const accParts = [poItem.accessoryType, poItem.accessoryBrand].filter(Boolean);
      productName = poItem.model
        ? `${accParts.join(' ')} สำหรับ ${poItem.model}`
        : accParts.join(' ');
    }
  } else {
    const nameParts = [poItem.brand, poItem.model, poItem.color, poItem.storage].filter(Boolean);
    productName = nameParts.join(' ');
  }
  return productName;
}
