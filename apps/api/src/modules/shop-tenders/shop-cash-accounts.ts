import { ShopCashDestination } from '@prisma/client';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';

/** JE ตอนยืนยันรับเงินปิดยอด (คำตัดสินเจ้าของ 2026-09-21) */
export const SHOP_CASH_CLOSE_FLOW = 'shop-cash-close';
/** JE ตอนบันทึกนำฝาก — ย้ายเงินจากตู้เซฟสาขา/เงินที่เจ้าของเก็บ เข้าธนาคารของร้าน */
export const SHOP_CASH_DEPOSIT_FLOW = 'shop-cash-deposit';
/** เงินขาด-เกินบัญชี — บัญชีเดียว ขาด = Dr · เกิน = Cr */
export const CASH_OVER_SHORT_ACCOUNT = 'S53-1104';
export const SHOP_DEPOSIT_BANK_ACCOUNT = ShopAccountResolver.SHOP_RECEIVING_BANK; // S11-1201
export const CASH_CLOSE_DESTINATION_ACCOUNT: Record<ShopCashDestination, string> = {
  BANK_DEPOSIT: SHOP_DEPOSIT_BANK_ACCOUNT,
  OWNER_HOLD: 'S11-1104',
  BRANCH_SAFE: 'S11-1105',
};
