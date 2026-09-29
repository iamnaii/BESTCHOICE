/**
 * Mock providers ของ dependency ฝั่งบัญชีที่ `PurchaseOrdersService` ต้องใช้ตอนรับสินค้าเข้า —
 * ใช้ร่วมกันทุก spec ของโมดูลนี้ (pattern เดียวกับ `journal/shop-templates/test-helpers.ts`)
 *
 * `ShopAccountResolver` ใช้ตัวจริง: การรับของเรียกเฉพาะเมธอด mapping หมวดสินค้า → รหัสบัญชี
 * ซึ่งเป็นฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล — mock ทับจะซ่อน mapping ที่ผิดจากเทสต์
 */
import { ShopGoodsReceivingTemplate } from '../journal/cpa-templates/shop-goods-receiving.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../journal/company-resolver.service';

export const TEST_SHOP_COMPANY_ID = 'shop-co-id';
export const TEST_JOURNAL_ENTRY_NO = 'JE-TEST-0001';

export function poJournalTestProviders() {
  const goodsReceivingTemplate = {
    execute: jest.fn().mockResolvedValue({ entryNo: TEST_JOURNAL_ENTRY_NO, journalEntryId: 'je-test-1' }),
  };
  const companyResolver = {
    getShopCompanyId: jest.fn().mockResolvedValue(TEST_SHOP_COMPANY_ID),
  };
  return {
    goodsReceivingTemplate,
    companyResolver,
    providers: [
      { provide: ShopGoodsReceivingTemplate, useValue: goodsReceivingTemplate },
      { provide: ShopAccountResolver, useValue: new ShopAccountResolver(null as never) },
      { provide: CompanyResolverService, useValue: companyResolver },
    ],
  };
}
