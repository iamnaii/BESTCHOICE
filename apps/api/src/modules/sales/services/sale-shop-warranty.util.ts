import { addDays } from 'date-fns';
import { captureProductDisclosure } from '../../../utils/product-disclosure.util';
import { readStringFlag, type SystemConfigReader } from '../../../utils/config.util';
import {
  resolveShopWarrantyDays,
  SHOP_WARRANTY_DAYS_CONFIG_KEY,
} from '../../warranty/shop-warranty-policy';

type DisclosureProduct = Parameters<typeof captureProductDisclosure>[0] & {
  shopWarrantyDays?: number | null;
};

/**
 * วันประกันร้านของ "เครื่องหลัก" บนใบขาย — ตัวเดียวสำหรับ POS (`SaleWriterService`) และส่งมอบเครื่องทดแทน
 * (PR 5 `AfterSalesExchangeService.deliverCash`). `shopWarrantyStartDate` ตั้งเสมอ เพราะเป็นฐานกรอบ
 * 7 วันของใบขายสด (`saleSoldAt`) แม้เครื่องไม่มีนโยบายประกันร้าน (เช่นเครื่องใหม่ หรือค่าเฉพาะเครื่อง = 0)
 */
export async function shopWarrantyDatesFor(
  tx: SystemConfigReader,
  product: DisclosureProduct,
  soldAt: Date,
) {
  const defaultDays = await readStringFlag(tx, SHOP_WARRANTY_DAYS_CONFIG_KEY, '');
  const days = resolveShopWarrantyDays(product, defaultDays);
  const productDisclosure = captureProductDisclosure(product, defaultDays);
  return {
    days,
    shopWarrantyStartDate: soldAt,
    shopWarrantyEndDate: days === null ? null : addDays(soldAt, days),
    productDisclosure,
  };
}
